"use client";

// Browser client for the companion's conversational interest manager
// (POST/GET /v0/chat — PER-172 / C4). ONE chat manages the WHOLE interest
// collection: a turn can create a new interest (+ its intent doc), refine/rename
// an existing one's doc, or delete one. The turn is async (kick → poll, exactly
// like briefs) so the UI never blocks on the ~claude round-trip.
//
// The contract that makes C5 honest (PER-139 no-dead-control): a `ready` turn's
// `changes` are ALREADY durable on disk before the poll sees them, so the FE
// fires its "Updated" beat only on a confirmed write — never optimistically.
// The TWO structured exceptions are `pending_delete` (PER-230) and
// `pending_rewrite` (PER-235): proposals the companion explicitly did NOT
// apply, with their own deterministic confirm routes — so the confirm cards
// the FE renders for them are real controls, not dead ones.

import { discoverCompanion } from "./companion";
import { readErrorBody } from "./errors";

// One change a turn applied to the interest collection. `interestId` is always
// the concrete (server-assigned, for create) id, so the FE can match it to a
// rendered card or add/remove in place without guessing. Mirrors the agent's
// ChatChange (packages/agent/src/state.ts).
export type ChatChange = {
  interestId: string;
  op: "create" | "update" | "delete";
  // Present for create/update; the (possibly renamed) topic. Absent on delete.
  topic?: string;
  // The full markdown doc as persisted, for create/update. Absent on delete.
  doc?: string;
};

// A delete the turn resolved to but did NOT apply (PER-230 confirm-gated delete).
// The interest is still alive; the FE renders a [Delete]/[Cancel] card and only
// calls confirmDeleteInterest() when the user presses [Delete]. Mirrors the
// agent's PendingDelete.
export type PendingDelete = {
  interestId: string;
  topic: string;
};

// A full-doc rewrite the turn proposed but did NOT apply (PER-235 confirm-gated
// rewrite). The doc on disk is untouched; the FE renders an [Apply]/[Discard]
// diff card and only calls confirmRewriteInterest() when the user presses
// [Apply]. `doc` is the complete proposed markdown — the server stores its own
// copy and writes THAT on confirm (the client never sends the doc back).
// Mirrors the agent's PendingRewrite.
export type PendingRewrite = {
  interestId: string;
  topic: string;
  doc: string;
};

// One chat turn held in the companion's single last-writer-wins slot. Mirrors
// the agent's ChatTurn.
export type ChatTurn = {
  id: string;
  created_at: string;
  status: "pending" | "ready" | "failed";
  message: string;
  reply?: string;
  changes?: ChatChange[];
  // A delete awaiting [Delete]/[Cancel] confirmation (PER-230). Not yet applied.
  pending_delete?: PendingDelete;
  // A full rewrite awaiting [Apply]/[Discard] confirmation (PER-235). Not yet
  // written — the doc on disk is unchanged until confirmRewriteInterest().
  pending_rewrite?: PendingRewrite;
  error_msg?: string;
};

export async function fetchChatTranscript(token: string): Promise<ChatTurn[]> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/chat`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { turns?: ChatTurn[] };
  return Array.isArray(json.turns) ? json.turns : [];
}

async function requireBase(): Promise<string> {
  const base = await discoverCompanion();
  if (!base) {
    throw new Error(
      "Scout isn't reachable. Start the companion (`scout-agent run`) and try again.",
    );
  }
  return base;
}

// Kick one chat turn. Returns the new turn id. Throws a human-readable error on
// 409 (a turn is already in flight — single chat slot) or 400 (empty / too long).
export async function kickChatTurn(
  message: string,
  token: string,
): Promise<string> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 409) {
    throw new Error(
      "Scout is still working on your last message — give it a moment.",
    );
  }
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(err.error ?? `Couldn't send that message (${res.status}).`);
  }
  const body = (await res.json()) as { turn_id?: string };
  if (!body.turn_id) throw new Error("Scout didn't accept that message.");
  return body.turn_id;
}

// Poll GET /v0/chat until the latest turn flips off `pending`, then resolve with
// the ready turn (reply + the change set it actually applied). A `ready` turn's
// changes are already persisted, so the caller can treat them as confirmed
// writes. Throws on a failed turn or if the deadline passes.
export async function pollChatTurn(
  turnId: string,
  token: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {},
): Promise<ChatTurn> {
  const base = await requireBase();
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const interval = opts.intervalMs ?? 1200;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, interval));
    let turn: ChatTurn | undefined;
    try {
      const res = await fetch(`${base}/v0/chat`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { turns?: ChatTurn[] };
      // The slot holds one turn; match by id, else take whatever's latest.
      turn = json.turns?.find((t) => t.id === turnId) ?? json.turns?.[0];
    } catch {
      continue; // transient poll error — keep waiting until the deadline
    }
    if (!turn) continue;
    if (turn.status === "ready") return turn;
    if (turn.status === "failed") {
      throw new Error(turn.error_msg ?? "Scout couldn't process that message.");
    }
  }
  throw new Error("Timed out waiting for Scout to reply.");
}

// Abort the in-flight chat turn server-side (PER-232). Stop must cancel the
// OPERATION, not just our poll — the companion is kick→poll, so dropping the
// fetch alone left the model edit to complete and persist ~14s later. This
// tells the companion to kill the model child and write the turn as stopped
// with NO changes applied. Best-effort: errors are swallowed (the worst case
// is the pre-PER-232 behavior, and the caller has already stopped the UI).
export async function stopChatTurn(
  token: string,
  turnId?: string,
): Promise<boolean> {
  try {
    const base = await requireBase();
    const res = await fetch(`${base}/v0/chat/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(turnId ? { turn_id: turnId } : {}),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { stopped?: boolean };
    return body.stopped === true;
  } catch {
    return false;
  }
}

// Confirm a gated delete (PER-230): the deterministic [Delete] press. POSTs the
// interestId to the companion, which removes the interest + its doc and returns
// a `ready` turn whose `changes` carry the applied delete. No model round-trip,
// so this resolves fast. Throws human-readable errors on 404 (already gone) /
// 409 (a turn is in flight).
export async function confirmDeleteInterest(
  interestId: string,
  token: string,
): Promise<ChatTurn> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/chat/confirm-delete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ interestId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 409) {
    throw new Error(
      "Scout is still working on your last message — give it a moment.",
    );
  }
  if (res.status === 404) {
    throw new Error("That interest was already removed.");
  }
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(
      err.error ?? `Couldn't remove that interest (${res.status}).`,
    );
  }
  const body = (await res.json()) as { turn?: ChatTurn };
  if (!body.turn) throw new Error("Scout didn't confirm the removal.");
  return body.turn;
}

// Confirm a gated rewrite (PER-235): the deterministic [Apply] press. POSTs the
// interestId to the companion, which writes its STORED proposed doc (the client
// never sends the doc) and returns a `ready` turn whose `changes` carry the
// applied update — so the caller routes it through the same confirmed-write
// seam as any other change (docs-rail flash). No model round-trip. Throws
// human-readable errors on 404 (proposal gone/stale) / 409 (a turn in flight).
export async function confirmRewriteInterest(
  interestId: string,
  token: string,
): Promise<ChatTurn> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/chat/confirm-rewrite`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ interestId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 409) {
    throw new Error(
      "Scout is still working on your last message — give it a moment.",
    );
  }
  if (res.status === 404) {
    throw new Error("That proposal expired — ask Scout for the rewrite again.");
  }
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(
      err.error ?? `Couldn't apply that rewrite (${res.status}).`,
    );
  }
  const body = (await res.json()) as { turn?: ChatTurn };
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
  // target this exact turn server-side (PER-232).
  opts.onKick?.(turnId);
  return pollChatTurn(turnId, token, opts);
}
