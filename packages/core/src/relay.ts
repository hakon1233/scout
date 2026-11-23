// The local account relay (docs/ARCHITECTURE.md, "Local account relay"): a
// local account (profiles.runs_local) makes no Claude API calls, so the Mac's
// gateway asks the Worker for the model request a chat turn, a publish check or
// a picks refresh would send, answers it with the local `claude`, and hands the
// text back. Shared by the Worker (packages/worker) and the Mac's gateway
// (packages/agent).
//
// Reader routes (POST /chat with {message}, POST /publish): the reader's
// `Authorization: Bearer <JWT>` plus both headers below.
//   RELAY_HEADER: "prompt"  same body as the normal route ->
//                           200 RelayPrompt with `x-scout-relay: prompt` on the
//                           response, or the normal route's answer when no
//                           model call was needed (a limit, a plain refusal).
//   RELAY_HEADER: "answer"  RelayAnswer -> the normal route's answer.
// Team routes (TEAM_PATHS.picksClaim, picksFinish): `Authorization: Bearer
// <TEAM_RUNNER_TOKEN>`, no relay headers.

import type { CliUsage } from "./contract.ts";

export const RELAY_HEADER = "x-scout-relay";
// Carries TEAM_RUNNER_TOKEN, since Authorization carries the reader's JWT.
export const RELAY_TOKEN_HEADER = "x-scout-relay-token";
export type RelayStep = "prompt" | "answer";

// What a local account's /chat message or /publish gets without the relay
// (409): nothing on that account may call the API.
export const LOCAL_ACCOUNT_MESSAGE =
  "This account runs on your Mac. Open Scout at https://openhakons-mac-mini.taildc1287.ts.net:47900.";

// The Messages API request the hosted function built, unchanged: the user
// message's prompt text, and the JSON schema the answer must follow
// (`output_config.format.schema`). `model` and `max_tokens` are the API's;
// the gateway may ignore them.
export type RelayModelRequest = {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: string; [field: string]: unknown }>;
  }>;
  tools?: Array<{ type: string; [field: string]: unknown }>;
  output_config?: {
    effort?: "low" | "medium" | "high";
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  };
};

// `turnId`: the chat turn's id, the publish check's id, or the picks run's id.
// Send it back in the RelayAnswer.
export type RelayPrompt = { turnId: string; request: RelayModelRequest };

export type RelayAnswer = {
  turnId: string;
  // The model's answer: the JSON the schema asks for, as text.
  text: string;
  // Kept as the call's tokens; its cost is recorded as 0.
  usage?: Partial<CliUsage>;
  // "max_tokens" or "refusal" fail the call as the API's would. Default end_turn.
  stopReason?: "end_turn" | "max_tokens" | "refusal";
};

// POST TEAM_PATHS.picksClaim {limit} -> TeamPicksClaim: one prompt for each
// local reader due new picks (a reader with no candidates is finished at once
// and not listed). POST TEAM_PATHS.picksFinish RelayAnswer -> {stored}.
export type TeamPicksClaim = { prompts: RelayPrompt[] };

// The answer's fields, or null when it isn't one the Worker reads.
export function parseRelayAnswer(
  body: unknown,
  maxTextChars: number,
): RelayAnswer | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.turnId !== "string" || b.turnId === "" || b.turnId.length > 64)
    return null;
  if (typeof b.text !== "string" || b.text.length > maxTextChars) return null;
  const stop = b.stopReason;
  if (
    stop !== undefined &&
    stop !== "end_turn" &&
    stop !== "max_tokens" &&
    stop !== "refusal"
  )
    return null;
  const count = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  const u =
    b.usage && typeof b.usage === "object"
      ? (b.usage as Record<string, unknown>)
      : {};
  return {
    turnId: b.turnId,
    text: b.text,
    usage: {
      inputTokens: count(u.inputTokens),
      outputTokens: count(u.outputTokens),
      cacheReadTokens: count(u.cacheReadTokens),
      cacheWriteTokens: count(u.cacheWriteTokens),
    },
    ...(stop ? { stopReason: stop } : {}),
  };
}
