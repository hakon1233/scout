// The local account relay on the Worker's side (core's relay.ts, protocol in
// docs/ARCHITECTURE.md, "Local account relay"): which step a request asks for,
// whether a reader is a local account, and the replay client built from the
// Mac's answer. http.ts (chat, publish) and team.ts (picks) use these; the
// hosted functions run unchanged under research's captureRequest/replayClient.
// Host-neutral.

import {
  RELAY_HEADER,
  RELAY_TOKEN_HEADER,
  type RelayAnswer,
  type RelayModelRequest,
  type RelayPrompt,
} from "@scout/core";
import { replayClient, type ClaudeClient } from "@scout/research";
import type { Json } from "./request.ts";
import { RpcError } from "./supabase.ts";

// The longest answer text read: more than the hosted calls' max_tokens give.
export const MAX_RELAY_TEXT_CHARS = 40_000;
// Room for that text (4 bytes a character at most) and the rest.
export const MAX_RELAY_BODY_BYTES = 192 * 1024;

// The relay step a request's header names: null for none, "bad" for a value
// that is not a step.
export function relayStepOf(
  request: Request,
): "prompt" | "answer" | null | "bad" {
  const step = request.headers.get(RELAY_HEADER);
  if (step === null) return null;
  return step === "prompt" || step === "answer" ? step : "bad";
}

export function relayTokenOf(request: Request): string | null {
  return request.headers.get(RELAY_TOKEN_HEADER);
}

// Whether the reader is a local account (profiles.runs_local). A reader with
// no profile row is not.
export async function readerRunsLocal(opts: {
  url: string;
  serviceKey: string;
  userId: string;
  fetch?: typeof fetch;
}): Promise<boolean> {
  const res = await (opts.fetch ?? globalThis.fetch)(
    `${opts.url}/rest/v1/profiles?select=runs_local&id=eq.${encodeURIComponent(opts.userId)}`,
    {
      method: "GET",
      headers: {
        apikey: opts.serviceKey,
        authorization: `Bearer ${opts.serviceKey}`,
      },
    },
  );
  const text = await res.text();
  if (!res.ok)
    throw new RpcError(
      res.status,
      undefined,
      `profiles: ${text.slice(0, 300)}`,
    );
  const rows = JSON.parse(text) as Array<{ runs_local?: unknown }>;
  return rows[0]?.runs_local === true;
}

// The client whose one call returns the Mac's answer, with its tokens.
export function relayClaude(answer: RelayAnswer): ClaudeClient {
  const u = answer.usage ?? {};
  return replayClient({
    text: answer.text,
    stopReason: answer.stopReason,
    usage: {
      input_tokens: u.inputTokens ?? 0,
      output_tokens: u.outputTokens ?? 0,
      cache_read_input_tokens: u.cacheReadTokens ?? 0,
      cache_creation_input_tokens: u.cacheWriteTokens ?? 0,
    },
  });
}

// The prompt step's answer: 200 RelayPrompt, marked `x-scout-relay: prompt`
// so the gateway tells it from the route's own answer.
export function relayPromptResponse(
  json: Json,
  turnId: string,
  request: RelayModelRequest,
): Response {
  const body: RelayPrompt = { turnId, request };
  const res = json(200, body);
  res.headers.set(RELAY_HEADER, "prompt");
  return res;
}
