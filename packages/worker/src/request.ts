// What every Worker route does before its own work: CORS for the web app's
// origins, JSON answers, the bearer token, the reader's verified sign-in and a
// size-capped body. http.ts (runs, chat, publish, account), voice.ts and
// team.ts all use these, so each rule lives once. Host-neutral.

import { verifiedUserId } from "./chat-store.ts";

export type Json = (status: number, body: unknown) => Response;

// A JSON body larger than this is refused (413) unread.
export const MAX_JSON_BODY_BYTES = 16 * 1024;

// CORS headers when the request's Origin is one of `allowedOrigin`
// (comma-separated); none for any other origin.
export function corsHeaders(
  request: Request,
  allowedOrigin: string,
): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigin.split(",").map((o) => o.trim());
  return origin && allowed.includes(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "authorization, content-type",
        vary: "origin",
      }
    : {};
}

// A JSON answer carrying `headers` (the route's CORS headers, or none).
export function jsonResponder(headers: Record<string, string> = {}): Json {
  return (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
}

// The token of `Authorization: Bearer <token>`, if there is one.
export function bearerToken(request: Request): string | undefined {
  return /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
}

// The reader's user id, checked with Supabase Auth, or the answer to send:
// 401 for a token Auth rejects, 502 when Auth can't be asked.
export async function signedInUser(
  jwt: string,
  deps: { supabaseUrl: string; anonKey: string; fetch?: typeof fetch },
  json: Json,
): Promise<string | Response> {
  let userId: string | null;
  try {
    userId = await verifiedUserId({
      url: deps.supabaseUrl,
      anonKey: deps.anonKey,
      userJwt: jwt,
      fetch: deps.fetch,
    });
  } catch {
    return json(502, {
      error: "Scout couldn't check your sign-in. Try again.",
    });
  }
  return userId ?? json(401, { error: "sign in first" });
}

// The body's bytes, or null when it is over `max`. Stops reading there.
export async function readCappedBytes(
  request: Request,
  max: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

// The body parsed as JSON, or null when it is over `max` bytes. An empty or
// garbled body reads as `undefined`; each route checks its own fields.
export async function readJsonBody(
  request: Request,
  max: number = MAX_JSON_BODY_BYTES,
): Promise<{ body: unknown } | null> {
  const bytes = await readCappedBytes(request, max);
  if (bytes === null) return null;
  const text = new TextDecoder().decode(bytes);
  try {
    return { body: text ? (JSON.parse(text) as unknown) : undefined };
  } catch {
    return { body: undefined };
  }
}
