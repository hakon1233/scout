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

import { discoverCompanion } from "./companion";

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

// One chat turn held in the companion's single last-writer-wins slot. Mirrors
// the agent's ChatTurn.
export type ChatTurn = {
  id: string;
  created_at: string;
  status: "pending" | "ready" | "failed";
  message: string;
  reply?: string;
  changes?: ChatChange[];
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
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
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

// Kick + poll one turn end-to-end. The resolved turn's `changes` are confirmed,
// durable writes the caller can apply to the doc cards.
export async function runChatTurn(
  message: string,
  token: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatTurn> {
  const turnId = await kickChatTurn(message, token);
  return pollChatTurn(turnId, token, opts);
}
