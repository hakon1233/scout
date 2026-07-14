// /v0/chat* — the conversational interest manager's five routes
// (PER-172 / C4, confirm seams PER-230/PER-235, stop PER-232).
// Moved out of server.ts in the PER-274 split; behavior unchanged. The
// model-facing logic lives in ../chat.ts — these handlers only validate the
// wire payloads and translate outcomes to status codes.

import {
  confirmDeleteTurn,
  confirmRewriteTurn,
  readChatTranscriptCached,
  startChatTurn,
  stopChatTurn,
} from "../chat.js";
import { json, jsonBodyParseError, parseJsonBody } from "../http-util.js";
import type { AuthedRequestContext, ServerContext } from "./types.js";

// A single chat message. Generous enough for a paragraph of intent, bounded so an
// oversized turn can't be forwarded into the (model-priced) chat prompt. (PER-172)
export const MAX_CHAT_MESSAGE_LEN = 4000;

// Kick one chat turn over the interest collection (PER-172 / C4). Async
// kick + poll, exactly like POST /v0/interests: we persist a `pending`
// turn and fire the (model-priced) round-trip fire-and-forget, returning
// 202 immediately. The caller polls GET /v0/chat?since= for the reply +
// the machine-readable change set the turn applied. Single chat slot,
// last-writer-wins → 409 while a turn is already pending (mirrors the
// brief single-flight), so two turns can't race on the interest set.
export async function handlePostChat(
  { req, res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{ message?: unknown }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;
  const message =
    typeof parsed.message === "string" ? parsed.message.trim() : "";
  if (!message) return json(res, 400, { error: "message required" }, cors);
  if (message.length > MAX_CHAT_MESSAGE_LEN) {
    return json(
      res,
      400,
      { error: `message too long, max ${MAX_CHAT_MESSAGE_LEN} chars` },
      cors,
    );
  }
  const outcome = await startChatTurn(message, sc.chatDeps);
  if (!outcome.started) {
    // The only non-empty reason here is in_flight (message was validated
    // non-empty above) → 409, echoing the in-flight turn id.
    const turnId = outcome.reason === "in_flight" ? outcome.turnId : undefined;
    return json(
      res,
      409,
      { error: "chat turn in progress", turn_id: turnId },
      cors,
    );
  }
  json(res, 202, { turn_id: outcome.turnId, status: "pending" }, cors);
}

// Abort the in-flight chat turn (PER-232). Stop in the UI must cancel
// the SERVER-side operation, not just the client poll — without this
// the in-flight model edit completed and persisted ~14s after Stop
// (AC3/AC5 fail). Kills the `claude` child and gates the change-apply,
// so the turn lands `failed` ("Stopped — no changes were applied.")
// with NO write to any interest doc. `turn_id` is optional: when given
// it must match the in-flight turn (a stale Stop can't kill a newer
// turn); without it, whatever is in flight is stopped (single-flight).
export async function handlePostChatStop({
  req,
  res,
  cors,
}: AuthedRequestContext): Promise<void> {
  const parsedBody = await parseJsonBody<{ turn_id?: unknown }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;
  const turnId = typeof parsed.turn_id === "string" ? parsed.turn_id : undefined;
  const stopped = stopChatTurn(turnId);
  json(res, 200, { stopped }, cors);
}

// Confirm a gated delete (PER-230). The destructive op is the ONLY one
// behind a confirmation: a model turn that resolved to a delete returns
// a `pending_delete` proposal (the interest stays alive); the FE renders
// a [Delete]/[Cancel] card and calls this route ONLY when the user presses
// [Delete]. Deterministic — no model spawn — so it returns the applied
// turn synchronously (200) for the FE to flash + drop the docs-rail card.
export async function handlePostChatConfirmDelete(
  { req, res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{ interestId?: unknown }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;
  const interestId =
    typeof parsed.interestId === "string" ? parsed.interestId : "";
  if (!interestId) return json(res, 400, { error: "interestId required" }, cors);
  const outcome = await confirmDeleteTurn(interestId, sc.chatDeps);
  if (!outcome.ok) {
    if (outcome.reason === "in_flight") {
      return json(res, 409, { error: "chat turn in progress" }, cors);
    }
    return json(res, 404, { error: "interest not found" }, cors);
  }
  json(res, 200, { turn: outcome.turn }, cors);
}

// Confirm a gated full rewrite (PER-235). Mirrors confirm-delete: a model
// turn that resolved to a from-scratch rewrite returns a `pending_rewrite`
// proposal (the doc on disk is untouched); the FE renders an [Apply]/
// [Discard] diff card and calls this route ONLY when the user presses
// [Apply]. The proposed doc is read from the STORED turn — the client
// sends only the interestId. Deterministic — no model spawn — so it
// returns the applied turn synchronously (200) for the FE to flash.
export async function handlePostChatConfirmRewrite(
  { req, res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{ interestId?: unknown }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;
  const interestId =
    typeof parsed.interestId === "string" ? parsed.interestId : "";
  if (!interestId) return json(res, 400, { error: "interestId required" }, cors);
  const outcome = await confirmRewriteTurn(interestId, sc.chatDeps);
  if (!outcome.ok) {
    if (outcome.reason === "in_flight") {
      return json(res, 409, { error: "chat turn in progress" }, cors);
    }
    return json(res, 404, { error: "no pending rewrite" }, cors);
  }
  json(res, 200, { turn: outcome.turn }, cors);
}

// Poll the latest chat turn (PER-172). Mirrors GET /v0/briefs: returns the
// single held turn when it's newer than `since` (its reply + applied
// changes once `ready`), else []. The FE polls this until `status` flips
// off `pending`, then renders the reply and re-`GET /v0/interests` (or
// applies `changes` in place) — the "Updated" beat fires on the confirmed
// change set, never a hopeful guess (PER-139).
export async function handleGetChat(
  { res, url, cors, state }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const since = url.searchParams.get("since");
  const transcript = await readChatTranscriptCached(sc.chatDeps.chatTranscriptFile);
  const last = state.last_chat;
  const byId = new Map(transcript.map((turn) => [turn.id, turn]));
  if (last && !byId.has(last.id)) byId.set(last.id, last);
  const matches = Array.from(byId.values())
    .filter((turn) => !since || turn.created_at > since)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  json(res, 200, { turns: matches }, cors);
}
