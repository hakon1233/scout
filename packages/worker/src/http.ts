// The Worker's routes, each with the reader's Supabase JWT as a bearer token:
//   POST /runs {interestId}      queue a run now; 202 {runId}. The next cron
//                                tick (within a minute) starts it.
//   POST /chat {message}         one setup chat turn; 200 ChatTurn.
//   POST /chat/confirm <confirm> confirm what the last turn proposed (a
//                                ChatConfirm); 200 ChatTurn, 409 if nothing waits.
// Host-neutral: Request and Response only.

import { quotaMessage } from "@scout/core";
import { createChat, type ChatConfirm } from "@scout/hosted";
import type { ClaudeClient } from "@scout/research";
import { supabaseChatStore, verifiedUserId } from "./chat-store.ts";
import { requestRun, RpcError, rpcCaller } from "./supabase.ts";

export type HttpDeps = {
  supabaseUrl: string;
  anonKey: string;
  // The web app's origin, for CORS. Other origins get no CORS headers.
  allowedOrigin: string;
  // The chat routes need both; without them they answer 404.
  serviceKey?: string;
  claude?: ClaudeClient;
  fetch?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_CHARS = 4000;
const ROUTES = new Set(["/runs", "/chat", "/chat/confirm"]);

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

  const path = new URL(request.url).pathname;
  if (!ROUTES.has(path)) return json(404, { error: "not found" });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });

  const jwt = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!jwt) return json(401, { error: "sign in first" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  if (path === "/runs") return runNow(body, jwt, deps, json);
  return chatRoute(path, body, jwt, deps, json);
}

type Json = (status: number, body: unknown) => Response;

async function runNow(
  body: unknown,
  jwt: string,
  deps: HttpDeps,
  json: Json,
): Promise<Response> {
  const interestId = (body as { interestId?: unknown } | undefined)?.interestId;
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

async function chatRoute(
  path: string,
  body: unknown,
  jwt: string,
  deps: HttpDeps,
  json: Json,
): Promise<Response> {
  const { serviceKey, claude } = deps;
  if (!serviceKey || !claude) return json(404, { error: "not found" });

  let input: { message: string } | { confirm: ChatConfirm } | null;
  if (path === "/chat") {
    const message = (body as { message?: unknown } | undefined)?.message;
    input =
      typeof message === "string" &&
      message.trim() !== "" &&
      message.length <= MAX_MESSAGE_CHARS
        ? { message: message.trim() }
        : null;
  } else {
    const confirm = parseConfirm(body);
    input = confirm ? { confirm } : null;
  }
  if (!input) return json(400, { error: "that request isn't one Scout reads" });

  try {
    const userId = await verifiedUserId({
      url: deps.supabaseUrl,
      anonKey: deps.anonKey,
      userJwt: jwt,
      fetch: deps.fetch,
    });
    if (!userId) return json(401, { error: "sign in first" });

    const service = { apikey: serviceKey, bearer: serviceKey };
    const rpc = rpcCaller(deps.supabaseUrl, deps.fetch);
    const blocked = (await rpc(
      "chat_block_reason",
      { p_user: userId },
      service,
    )) as string | null;
    if (blocked) return json(429, { error: blocked });

    const chat = createChat({
      claude,
      store: supabaseChatStore({
        url: deps.supabaseUrl,
        serviceKey,
        fetch: deps.fetch,
      }),
    });
    if ("message" in input)
      return json(200, await chat.turn(userId, input.message));
    const turn = await chat.confirm(userId, input.confirm);
    return turn
      ? json(200, turn)
      : json(409, { error: "There is nothing waiting to confirm." });
  } catch (err) {
    // A change past the reader's limits, refused by the interest trigger.
    const limit =
      err instanceof RpcError
        ? quotaMessage({ code: err.code, hint: err.hint, message: err.message })
        : null;
    if (limit) return json(429, { error: limit });
    console.error("[chat] store failed:", err);
    return json(502, { error: "Scout couldn't save that. Try again." });
  }
}

function parseConfirm(body: unknown): ChatConfirm | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.kind === "delete") {
    const ids = b.interestIds;
    return Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => typeof id === "string")
      ? { kind: "delete", interestIds: ids as string[] }
      : null;
  }
  if (
    (b.kind === "rewrite" || b.kind === "follow") &&
    typeof b.interestId === "string"
  )
    return { kind: b.kind, interestId: b.interestId };
  return null;
}
