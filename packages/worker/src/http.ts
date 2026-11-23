// The Worker's routes, each with the reader's Supabase JWT as a bearer token:
//   POST /runs {interestId}      queue a run now; 202 {runId}. The next cron
//                                tick (within a minute) starts it.
//   POST /chat {message}         one setup chat turn; 200 ChatTurn.
//   POST /chat/confirm <confirm> confirm what the last turn proposed (a
//                                ChatConfirm); 200 ChatTurn, 409 if nothing waits.
//   POST /publish {interest}     run the publish check on one of the reader's
//                                topics; 200 PublishResponse (core), 429
//                                {error: "limit", message}, 404, 409, 503.
//   POST /account/delete         delete the reader's account: their topics
//                                first (followers are told), then the auth
//                                user, whose rows cascade; 200 {deleted: true}.
// A local account (profiles.runs_local) makes no Claude API calls: its /chat
// message and /publish answer 409 with LOCAL_ACCOUNT_MESSAGE, unless sent
// through the relay (the Mac's gateway; core's relay.ts, docs/ARCHITECTURE.md
// "Local account relay"): `x-scout-relay: prompt | answer` and
// `x-scout-relay-token: <TEAM_RUNNER_TOKEN>` beside the reader's JWT.
// Bodies over 16 KB are refused (413) unread (a relay answer: 192 KB). The service-role routes verify
// the JWT with Supabase Auth before reading the body.
// The /team routes (team.ts) take their own tokens instead of a reader's JWT.
// Host-neutral: Request and Response only.

import {
  LOCAL_ACCOUNT_MESSAGE,
  MAX_CHAT_MESSAGE_CHARS,
  parseRelayAnswer,
  quotaMessage,
  type PublishVerdict,
  type RelayAnswer,
  type RelayStep,
} from "@scout/core";
import {
  PublishCheckFailed,
  createChat,
  createPublish,
  type ChatConfirm,
  type ChatStore,
  type PublishStart,
  type PublishStore,
} from "@scout/hosted";
import { captureRequest, type ClaudeClient } from "@scout/research";
import { pendingChatMessage, supabaseChatStore } from "./chat-store.ts";
import {
  MAX_RELAY_BODY_BYTES,
  MAX_RELAY_TEXT_CHARS,
  readerRunsLocal,
  relayClaude,
  relayPromptResponse,
  relayStepOf,
  relayTokenOf,
} from "./relay.ts";
import {
  bearerToken,
  corsHeaders,
  jsonResponder,
  readJsonBody,
  sameSecret,
  signedInUser,
  type Json,
} from "./request.ts";
import { requestRun, RpcError, rpcCaller } from "./supabase.ts";
import { handleTeamRequest, isTeamPath, type TeamDeps } from "./team.ts";
import { handleVoiceRequest, type VoiceAi } from "./voice.ts";
import {
  handleUnsubscribe,
  supabaseEmailStore,
  UNSUBSCRIBE_PATH,
} from "./email.ts";

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
const ROUTES = new Set([
  "/runs",
  "/chat",
  "/chat/confirm",
  "/publish",
  "/account/delete",
]);
// The routes that act with the service role, for a reader Auth has verified.
const SERVICE_ROUTES = new Set([
  "/chat",
  "/chat/confirm",
  "/publish",
  "/account/delete",
]);
// The routes that call Claude for a reader: a local account's go through the
// relay only.
const MODEL_ROUTES = new Set(["/chat", "/publish"]);

export async function handleRequest(
  request: Request,
  deps: HttpDeps,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (isTeamPath(path)) return handleTeamRequest(request, deps);
  if (path === "/voice") return handleVoiceRequest(request, deps);
  // A brief email's one-click unsubscribe link (email.ts): signed, no sign-in.
  if (path === UNSUBSCRIBE_PATH && deps.serviceKey) {
    return handleUnsubscribe(request, {
      signingKey: deps.serviceKey,
      store: supabaseEmailStore({
        url: deps.supabaseUrl,
        serviceKey: deps.serviceKey,
        fetch: deps.fetch,
      }),
    });
  }

  const cors = corsHeaders(request, deps.allowedOrigin);
  const json = jsonResponder(cors);

  if (!ROUTES.has(path)) return json(404, { error: "not found" });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });

  const jwt = bearerToken(request);
  if (!jwt) return json(401, { error: "sign in first" });

  // The relay: the Mac's gateway, holding TEAM_RUNNER_TOKEN.
  const step = relayStepOf(request);
  if (step === "bad" || (step && !MODEL_ROUTES.has(path)))
    return json(400, { error: "that relay request isn't one Scout reads" });
  if (step) {
    if (!deps.teamToken) return json(404, { error: "not found" });
    const given = relayTokenOf(request);
    if (!given || !(await sameSecret(given, deps.teamToken)))
      return json(401, { error: "wrong relay token" });
  }

  let userId: string | null = null;
  if (SERVICE_ROUTES.has(path)) {
    if (!deps.serviceKey || !deps.claude)
      return json(404, { error: "not found" });
    const user = await signedInUser(jwt, deps, json);
    if (user instanceof Response) return user;
    userId = user;
  }

  if (MODEL_ROUTES.has(path)) {
    let local: boolean;
    try {
      local = await readerRunsLocal({
        url: deps.supabaseUrl,
        serviceKey: deps.serviceKey as string,
        userId: userId as string,
        fetch: deps.fetch,
      });
    } catch (err) {
      console.error("[relay] runs_local lookup failed:", err);
      return json(502, {
        error: "Scout couldn't check your account. Try again.",
      });
    }
    if (local && !step) return json(409, { error: LOCAL_ACCOUNT_MESSAGE });
    if (!local && step)
      return json(403, { error: "the relay is only for local accounts" });
  }

  const read = await readJsonBody(
    request,
    step === "answer" ? MAX_RELAY_BODY_BYTES : undefined,
  );
  if (!read) return json(413, { error: "that request is too large" });
  const { body } = read;

  if (path === "/runs") return runNow(body, jwt, deps, json);
  if (path === "/account/delete")
    return deleteAccount(userId as string, deps, json);
  if (path === "/publish")
    return publishRoute(body, userId as string, deps, json, step);
  return chatRoute(path, body, userId as string, deps, json, step);
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
  step: RelayStep | null,
): Promise<Response> {
  const serviceKey = deps.serviceKey as string;

  let input:
    | { message: string }
    | { confirm: ChatConfirm }
    | { answer: RelayAnswer }
    | null;
  if (step === "answer") {
    const answer = parseRelayAnswer(body, MAX_RELAY_TEXT_CHARS);
    input = answer && UUID.test(answer.turnId) ? { answer } : null;
  } else if (path === "/chat") {
    const message = (body as { message?: unknown } | undefined)?.message;
    input =
      typeof message === "string" &&
      message.trim() !== "" &&
      message.length <= MAX_CHAT_MESSAGE_CHARS
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
    const supabase = { url: deps.supabaseUrl, serviceKey, fetch: deps.fetch };
    const store = supabaseChatStore(supabase);
    // A relayed turn's call ran on the Mac: its tokens are kept, its cost is 0.
    const relayStore: ChatStore = {
      ...store,
      commit: (user, commit) => store.commit(user, { ...commit, costUsd: 0 }),
    };

    if ("answer" in input) {
      // The turn the prompt step reserved, still waiting: its message is the
      // one the prompt was built from.
      const { answer } = input;
      const message = await pendingChatMessage(supabase, userId, answer.turnId);
      if (message === null)
        return json(409, { error: "That turn is not waiting for an answer." });
      const chat = createChat({
        claude: relayClaude(answer),
        store: relayStore,
      });
      return json(
        200,
        await chat.turn(userId, message, { turnId: answer.turnId }),
      );
    }

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
    } else if (input.confirm.kind !== "feedback") {
      // A feedback confirm is free; send_feedback has its own limits.
      const blocked = (await rpc(
        "chat_block_reason",
        { p_user: userId },
        service,
      )) as string | null;
      if (blocked) return json(429, { error: blocked });
    }

    if ("message" in input && step === "prompt") {
      const { message } = input;
      const out = await captureRequest((claude) =>
        createChat({ claude, store: relayStore }).turn(userId, message, {
          turnId,
        }),
      );
      return "captured" in out
        ? relayPromptResponse(json, turnId as string, out.captured)
        : json(200, out.done);
    }

    const chat = createChat({ claude: deps.claude as ClaudeClient, store });
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

// A relayed answer names a check that is not open (finished, too old, or
// another reader's).
class CheckNotWaiting extends Error {}

// The publish check: publish_start checks ownership and the limits and opens a
// check row; one Haiku call; publish_finish records the verdict and, on
// approve, sets the tags and makes the topic public. Through the relay, the
// prompt step stops at the call and the answer step reopens the same check
// (publish_relay_start) with the Mac's answer, recorded at no cost.
async function publishRoute(
  body: unknown,
  userId: string,
  deps: HttpDeps,
  json: Json,
  step: RelayStep | null,
): Promise<Response> {
  let interest = "";
  let answer: RelayAnswer | null = null;
  if (step === "answer") {
    answer = parseRelayAnswer(body, MAX_RELAY_TEXT_CHARS);
    if (!answer || !/^\d{1,18}$/.test(answer.turnId))
      return json(400, { error: "that answer isn't one Scout reads" });
  } else {
    const given = (body as { interest?: unknown } | undefined)?.interest;
    if (typeof given !== "string" || !UUID.test(given))
      return json(400, { error: "interest must be a topic's id" });
    interest = given;
  }

  const serviceKey = deps.serviceKey as string;
  const service = { apikey: serviceKey, bearer: serviceKey };
  const rpc = rpcCaller(deps.supabaseUrl, deps.fetch);
  let openedCheck: string | undefined;
  const store: PublishStore = {
    async start(user, interestId) {
      let s: Omit<PublishStart, "checkId"> & { checkId: number | string };
      if (answer) {
        try {
          s = (await rpc(
            "publish_relay_start",
            { p_user: user, p_check: Number(answer.turnId) },
            service,
          )) as typeof s;
        } catch (err) {
          if (err instanceof RpcError && err.code === "P0002")
            throw new CheckNotWaiting();
          throw err;
        }
      } else {
        s = (await rpc(
          "publish_start",
          { p_user: user, p_interest: interestId },
          service,
        )) as typeof s;
      }
      openedCheck = String(s.checkId);
      return { ...s, checkId: openedCheck };
    },
    async finish(user, checkId, verdict: PublishVerdict, costUsd, tokens) {
      return (await rpc(
        "publish_finish",
        {
          p_user: user,
          p_check: Number(checkId),
          p_approved: verdict.approved,
          p_tags: verdict.approved ? verdict.tags : [],
          p_reason: verdict.approved ? null : verdict.reason,
          // A relayed check ran on the Mac: tokens kept, no cost.
          p_cost_usd: step ? 0 : costUsd,
          p_input_tokens: tokens.inputTokens,
          p_output_tokens: tokens.outputTokens,
        },
        service,
      )) as string | null;
    },
  };

  try {
    if (step === "prompt") {
      const out = await captureRequest((claude) =>
        createPublish({ claude, store }).publish(userId, interest),
      );
      return "captured" in out
        ? relayPromptResponse(json, openedCheck as string, out.captured)
        : json(200, out.done);
    }
    const claude = answer ? relayClaude(answer) : (deps.claude as ClaudeClient);
    return json(
      200,
      await createPublish({ claude, store }).publish(userId, interest),
    );
  } catch (err) {
    if (err instanceof CheckNotWaiting)
      return json(409, { error: "That check is not waiting for an answer." });
    if (err instanceof PublishCheckFailed)
      return json(503, {
        error: "Scout couldn't check this topic. Try again later.",
      });
    if (err instanceof RpcError) {
      if (err.code === "P0001")
        return json(429, {
          error: "limit",
          message:
            quotaMessage({
              code: err.code,
              hint: err.hint,
              message: err.message,
            }) ?? "You've reached a publishing limit.",
        });
      if (err.code === "P0002")
        return json(404, { error: "That topic isn't yours or is gone." });
      if (err.code === "22023" && err.hint === "already_public")
        return json(409, { error: "This topic is already public." });
      if (err.code === "40001")
        return json(409, {
          error: "The topic changed during the check. Try again.",
        });
    }
    console.error("[publish] failed:", err);
    return json(502, { error: "Scout couldn't publish that. Try again." });
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
      ? { kind: "delete", interestIds: ids }
      : null;
  }
  if (
    (b.kind === "rewrite" || b.kind === "follow" || b.kind === "create") &&
    typeof b.interestId === "string"
  )
    return { kind: b.kind, interestId: b.interestId };
  if (b.kind === "feedback") return { kind: "feedback" };
  return null;
}
