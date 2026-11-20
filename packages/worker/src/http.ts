// The Worker's routes, each with the reader's Supabase JWT as a bearer token:
//   POST /runs {interestId}      queue a run now; 202 {runId}. The next cron
//                                tick (within a minute) starts it.
//   POST /chat {message}         one setup chat turn; 200 ChatTurn.
//   POST /chat/confirm <confirm> confirm what the last turn proposed (a
//                                ChatConfirm); 200 ChatTurn, 409 if nothing waits.
//   POST /account/delete         delete the reader's account: their topics
//                                first (followers are told), then the auth
//                                user, whose rows cascade; 200 {deleted: true}.
// Bodies over 16 KB are refused (413) unread. The service-role routes verify
// the JWT with Supabase Auth before reading the body.
// The /team routes (team.ts) take their own tokens instead of a reader's JWT.
// Host-neutral: Request and Response only.

import { quotaMessage } from "@scout/core";
import { createChat, type ChatConfirm } from "@scout/hosted";
import type { ClaudeClient } from "@scout/research";
import { supabaseChatStore, verifiedUserId } from "./chat-store.ts";
import { requestRun, RpcError, rpcCaller } from "./supabase.ts";
import { handleTeamRequest, isTeamPath, type TeamDeps } from "./team.ts";
import { handleVoiceRequest, type VoiceAi } from "./voice.ts";

export type HttpDeps = {
  supabaseUrl: string;
  anonKey: string;
  // The web app's origins for CORS, comma-separated. Other origins get no
  // CORS headers.
  allowedOrigin: string;
  // The chat routes need both; without them they answer 404.
  serviceKey?: string;
  claude?: ClaudeClient;
  fetch?: typeof fetch;
  ai?: VoiceAi; // POST /voice (voice.ts)
} & Pick<TeamDeps, "teamToken" | "moderationToken">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_CHARS = 4000;
const MAX_BODY_BYTES = 16 * 1024;
const ROUTES = new Set(["/runs", "/chat", "/chat/confirm", "/account/delete"]);
// The routes that act with the service role, for a reader Auth has verified.
const SERVICE_ROUTES = new Set(["/chat", "/chat/confirm", "/account/delete"]);

export async function handleRequest(
  request: Request,
  deps: HttpDeps,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (isTeamPath(path)) return handleTeamRequest(request, deps);
  if (path === "/voice") return handleVoiceRequest(request, deps);

  const origin = request.headers.get("origin");
  const allowed = deps.allowedOrigin.split(",").map((o) => o.trim());
  const cors: Record<string, string> =
    origin && allowed.includes(origin)
      ? {
          "access-control-allow-origin": origin,
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

  if (!ROUTES.has(path)) return json(404, { error: "not found" });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });

  const jwt = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!jwt) return json(401, { error: "sign in first" });

  let userId: string | null = null;
  if (SERVICE_ROUTES.has(path)) {
    if (!deps.serviceKey || !deps.claude)
      return json(404, { error: "not found" });
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
    if (!userId) return json(401, { error: "sign in first" });
  }

  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return json(413, { error: "that request is too large" });
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (path === "/runs") return runNow(body, jwt, deps, json);
  if (path === "/account/delete")
    return deleteAccount(userId as string, deps, json);
  return chatRoute(path, body, userId as string, deps, json);
}

// The body as text, or null when it is over `max` bytes. Stops reading there.
async function readCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
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
  return new TextDecoder().decode(all);
}

async function deleteAccount(
  userId: string,
  deps: HttpDeps,
  json: Json,
): Promise<Response> {
  const serviceKey = deps.serviceKey as string;
  const doFetch = deps.fetch ?? globalThis.fetch;
  try {
    await rpcCaller(deps.supabaseUrl, doFetch)(
      "prepare_account_delete",
      { p_user: userId },
      { apikey: serviceKey, bearer: serviceKey },
    );
    const res = await doFetch(
      `${deps.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      },
    );
    if (!res.ok) throw new Error(`auth user delete: ${res.status}`);
    return json(200, { deleted: true });
  } catch (err) {
    console.error("[account] delete failed:", err);
    return json(502, {
      error: "Scout couldn't delete your account. Try again.",
    });
  }
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
      if (err.code === "P0001")
        return json(429, {
          error:
            quotaMessage({
              code: err.code,
              hint: err.hint,
              message: err.message,
            }) ?? err.message,
        });
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
  userId: string,
  deps: HttpDeps,
  json: Json,
): Promise<Response> {
  const serviceKey = deps.serviceKey as string;
  const claude = deps.claude as ClaudeClient;

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
    const service = { apikey: serviceKey, bearer: serviceKey };
    const rpc = rpcCaller(deps.supabaseUrl, deps.fetch);
    // A message reserves its turn (a pending row, under the reader's lock)
    // before Claude is called, so parallel requests cannot pass the limit.
    let turnId: string | undefined;
    if ("message" in input) {
      const begun = (await rpc(
        "begin_chat_turn",
        { p_user: userId, p_message: input.message },
        service,
      )) as { blocked?: string; id?: string };
      if (begun.blocked) return json(429, { error: begun.blocked });
      turnId = begun.id;
    } else {
      const blocked = (await rpc(
        "chat_block_reason",
        { p_user: userId },
        service,
      )) as string | null;
      if (blocked) return json(429, { error: blocked });
    }

    const chat = createChat({
      claude,
      store: supabaseChatStore({
        url: deps.supabaseUrl,
        serviceKey,
        fetch: deps.fetch,
      }),
    });
    if ("message" in input)
      return json(200, await chat.turn(userId, input.message, { turnId }));
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
