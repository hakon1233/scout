"use client";

// Browser client for the companion's conversational interest manager (POST/GET
// /v0/chat). ONE chat manages the WHOLE interest collection: a turn can create
// a new interest (+ its intent doc), refine/rename an existing one's doc, or
// delete one. The turn is async (kick → poll, exactly like briefs) so the UI
// never blocks on the ~claude round-trip.
//
// The contract that keeps the chat UI honest (no dead controls): a `ready`
// turn's `changes` are ALREADY durable on disk before the poll sees them, so
// the FE fires its "Updated" beat only on a confirmed write — never
// optimistically. The TWO structured exceptions are `pending_deletes` and
// `pending_rewrite`: proposals the companion explicitly did NOT apply, with
// their own deterministic confirm routes — so the confirm cards the FE renders
// for them are real controls, not dead ones.

import { companionFetch, companionJson } from "./companion";
import { PATHS, type ChatTurn } from "@scout/agent/contract";

const BUSY = "Scout is still working on your last message — give it a moment.";

export async function fetchChatTranscript(token: string): Promise<ChatTurn[]> {
  const res = await companionFetch(PATHS.chat, { token });
  if (!res.ok) return [];
  const json = (await res.json()) as { turns?: ChatTurn[] };
  return Array.isArray(json.turns) ? json.turns : [];
}

// Kick one chat turn. Returns the new turn id. Throws a human-readable error on
// 409 (a turn is already in flight — single chat slot) or 400 (empty / too long).
export async function kickChatTurn(
  message: string,
  token: string,
): Promise<string> {
  const body = await companionJson<{ turn_id?: string }>(PATHS.chat, {
    token,
    method: "POST",
    body: { message },
    timeoutMs: 10_000,
    failure: "Couldn't send that message",
    messages: { 409: BUSY },
  });
  if (!body.turn_id) throw new Error("Scout didn't accept that message.");
  return body.turn_id;
}

// Poll GET /v0/chat until the turn flips off `pending`, then resolve with it:
// `ready` (its changes are already persisted, so the caller can treat them as
// confirmed writes) or `failed` (the companion ran it and gave up; nothing was
// applied). Throws when the poll itself gives up: the turn may still finish.
export async function pollChatTurn(
  turnId: string,
  token: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {},
): Promise<ChatTurn> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const interval = opts.intervalMs ?? 1200;
  // GET /v0/chat?since= filters by created_at server-side: without
  // it every tick re-transfers the WHOLE persisted transcript just to check
  // this one turn's status, which only gets worse as chat history grows.
  // The companion is loopback (same clock as this tab), so a generous 30s
  // slack safely predates the turn's created_at (set moments ago, when the
  // kick's POST was handled) while still excluding older history.
  const since = new Date(Date.now() - 30_000).toISOString();
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, interval));
    let turn: ChatTurn | undefined;
    try {
      const res = await companionFetch(
        `${PATHS.chat}?since=${encodeURIComponent(since)}`,
        { token },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { turns?: ChatTurn[] };
      turn = json.turns?.find((t) => t.id === turnId);
    } catch {
      continue; // transient poll error — keep waiting until the deadline
    }
    if (!turn) continue;
    if (turn.status !== "pending") return turn;
  }
  throw new Error("Timed out waiting for Scout to reply.");
}

// Abort the in-flight chat turn server-side. Stop must cancel the
// OPERATION, not just our poll — the companion is kick→poll, so dropping the
// fetch alone left the model edit to complete and persist ~14s later. This
// tells the companion to kill the model child and write the turn as stopped
// with NO changes applied. Best-effort: errors are swallowed (the worst case is
// a server-side turn that still completes, and the caller has already stopped
// the UI).
export async function stopChatTurn(
  token: string,
  turnId?: string,
): Promise<boolean> {
  try {
    const res = await companionFetch(PATHS.chatStop, {
      token,
      method: "POST",
      body: turnId ? { turn_id: turnId } : {},
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { stopped?: boolean };
    return body.stopped === true;
  } catch {
    return false;
  }
}

// Confirm a gated delete: the deterministic [Delete] press. POSTs the
// interestId to the companion, which removes the interest + its doc and returns
// a `ready` turn whose `changes` carry the applied delete. No model round-trip,
// so this resolves fast. Throws human-readable errors on 404 (already gone) /
// 409 (a turn is in flight).
export async function confirmDeleteInterest(
  interestIds: string[],
  token: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatTurn> {
  const body = await companionJson<{ turn?: ChatTurn }>(
    PATHS.chatConfirmDelete,
    {
      token,
      method: "POST",
      body: { interestId: interestIds[0], interestIds },
      timeoutMs: 10_000,
      signal: opts.signal,
      failure: "Couldn't remove that interest",
      messages: { 409: BUSY, 404: "That interest was already removed." },
    },
  );
  if (!body.turn) throw new Error("Scout didn't confirm the removal.");
  return body.turn;
}

// Confirm a gated rewrite: the deterministic [Apply] press. POSTs the
// interestId to the companion, which writes its STORED proposed doc (the client
// never sends the doc) and returns a `ready` turn whose `changes` carry the
// applied update — so the caller routes it through the same confirmed-write
// seam as any other change (docs-rail flash). No model round-trip. Throws
// human-readable errors on 404 (proposal gone/stale) / 409 (a turn in flight).
export async function confirmRewriteInterest(
  interestId: string,
  token: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatTurn> {
  const body = await companionJson<{ turn?: ChatTurn }>(
    PATHS.chatConfirmRewrite,
    {
      token,
      method: "POST",
      body: { interestId },
      timeoutMs: 10_000,
      signal: opts.signal,
      failure: "Couldn't apply that rewrite",
      messages: {
        409: BUSY,
        404: "That proposal expired — ask Scout for the rewrite again.",
      },
    },
  );
  if (!body.turn) throw new Error("Scout didn't confirm the rewrite.");
  return body.turn;
}

// Kick + poll one turn end-to-end. The resolved turn's `changes` are confirmed,
// durable writes the caller can apply to the doc cards.
export async function runChatTurn(
  message: string,
  token: string,
  opts: { signal?: AbortSignal; onKick?: (turnId: string) => void } = {},
): Promise<ChatTurn> {
  const turnId = await kickChatTurn(message, token);
  // Hand the turn id to the caller as soon as the kick lands, so a Stop can
  // target this exact turn server-side.
  opts.onKick?.(turnId);
  return pollChatTurn(turnId, token, opts);
}
