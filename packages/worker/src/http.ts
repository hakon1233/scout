// The Worker's one route: POST /runs {interestId} with the reader's Supabase
// JWT as a bearer token. It queues a run-now request and answers 202 {runId};
// the next cron tick (within a minute) starts it. Host-neutral: Request and
// Response only.

import { requestRun, RpcError } from "./supabase.ts";

export type HttpDeps = {
  supabaseUrl: string;
  anonKey: string;
  // The web app's origin, for CORS. Other origins get no CORS headers.
  allowedOrigin: string;
  fetch?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleRequest(
  request: Request,
  deps: HttpDeps,
): Promise<Response> {
  const cors: Record<string, string> =
    request.headers.get("origin") === deps.allowedOrigin
      ? {
          "access-control-allow-origin": deps.allowedOrigin,
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": "authorization, content-type",
          vary: "origin",
        }
      : {};
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...cors },
    });

  if (new URL(request.url).pathname !== "/runs")
    return json(404, { error: "not found" });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });

  const jwt = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!jwt) return json(401, { error: "sign in first" });

  let interestId: unknown;
  try {
    interestId = ((await request.json()) as { interestId?: unknown })
      .interestId;
  } catch {
    interestId = undefined;
  }
  if (typeof interestId !== "string" || !UUID.test(interestId))
    return json(400, { error: "interestId must be an interest's id" });

  try {
    const runId = await requestRun({
      url: deps.supabaseUrl,
      anonKey: deps.anonKey,
      userJwt: jwt,
      interestId,
      fetch: deps.fetch,
    });
    return json(202, { runId });
  } catch (err) {
    if (err instanceof RpcError) {
      if (err.code === "P0001") return json(429, { error: err.message });
      if (err.code === "P0002") return json(404, { error: err.message });
      if (err.status === 401 || err.code === "42501" || err.code === "PGRST301")
        return json(401, { error: "sign in first" });
    }
    return json(502, { error: "could not queue the run" });
  }
}
