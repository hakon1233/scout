// Conversational interest manager (PER-172 / C4).
//
// ONE chat manages the WHOLE set of interest docs. A single turn can:
//   - create a new interest (+ its `<id>.md` intent doc),
//   - refine/rename an existing interest's doc/topic,
//   - delete an interest (+ its doc).
//
// We delegate the natural-language reasoning to a headless `claude` child
// through claude-runner.ts, the same seam research uses: the prompt goes over
// stdin and the CLI authenticates itself. The user's credentials never pass
// through this process (the contract tests check argv, env and stdin).
//
// Unlike research, the child gets NO tools at all and touches no files. It
// only reasons over the interest snapshot we hand it and returns a structured
// change set as JSON. THIS module is the trusted applier: it validates each
// change against the current interest set, mints ids server-side (a model must
// never invent an `int_…` id, nor write an arbitrary `<id>.md`), persists via the
// docs.ts / state.ts helpers, and only then flips the turn to `ready`. That keeps
// the change set machine-readable AND makes the doc edit observable in the same
// turn (CEO contract e81f2c2a) — and a created/deleted interest also lands in
// `state.interests`, which a model editing files alone could never accomplish.

import type { spawn } from "node:child_process";
import { loadState, newChatTurnId, updateState } from "./state.js";
import type { ChatChange, ChatTurn } from "./contract.js";
import { writeInterestDoc } from "./docs.js";
import { buildInterestSnapshots, chatComplete } from "./chat-model.js";
import {
  applyChatChanges,
  applyConfirmedDelete,
  replayChanges,
} from "./chat-changes.js";
import {
  appendChatTranscript,
  defaultChatTranscriptFile,
  readChatTranscriptCached,
} from "./chat-transcript.js";

export type ChatDeps = {
  stateFile: string;
  interestsDir: string;
  chatTranscriptFile?: string;
  claudeBin?: string;
  spawnFn?: typeof spawn;
  // Per-turn hard timeout in ms (AIR-540), threaded to chatComplete. Tests set
  // it tiny to drive the hung-child kill path through the in-flight guard.
  timeoutMs?: number;
  // Fired when a turn finishes (ready or failed). Tests await this.
  onChatDone?: (turn: ChatTurn) => void;
};

// The transcript lives next to the state file unless a caller pins it.
function transcriptFileFor(deps: ChatDeps): string {
  return deps.chatTranscriptFile ?? defaultChatTranscriptFile(deps.stateFile);
}

export type ChatOutcome =
  | { started: true; turnId: string }
  | { started: false; reason: "in_flight"; turnId?: string }
  | { started: false; reason: "empty_message" };

// Single-process, single-flight guard (mirrors runner.ts). One chat turn at a
// time: a turn reads-then-writes the interest set, so overlapping turns could
// clobber each other's edits.
let chatInFlight = false;

// PER-232: Stop must abort the SERVER-side turn, not just the client poll. The
// architecture is kick→poll (no SSE), so the client dropping its fetch is
// invisible here — without this, the in-flight `claude` edit completed and was
// persisted ~14s after the user pressed Stop. We hold one AbortController per
// in-flight turn (single-flight, so at most one); stopChatTurn() fires it, which
// kills the child AND gates applyChatChanges, so a stopped turn commits nothing.
let currentTurnAbort: { turnId: string; controller: AbortController } | null =
  null;

// Canonical "user pressed Stop" outcome. The turn lands as `failed` with this
// message (a new status value would ripple through every ChatTurn consumer);
// the FE recognizes a stop locally anyway and suppresses the error bubble.
const CHAT_STOPPED_MSG = "Stopped — no changes were applied.";

// Abort the in-flight chat turn (PER-232). With a turnId, only aborts when it
// matches the in-flight turn (a stale Stop can't kill a newer turn); without
// one, aborts whatever is in flight. Returns whether a turn was aborted.
export function stopChatTurn(turnId?: string): boolean {
  if (!currentTurnAbort) return false;
  if (turnId && currentTurnAbort.turnId !== turnId) return false;
  currentTurnAbort.controller.abort();
  return true;
}

export function isChatInFlight(): boolean {
  return chatInFlight;
}

// How long a persisted `pending` chat turn may survive WITHOUT this process
// actively running it before we treat it as abandoned and reclaim the slot. A
// live turn in this process is guarded by `chatInFlight`; a persisted-only
// pending turn means the companion likely restarted after writing the slot.
const STALE_PENDING_CHAT_MS = 5 * 60 * 1000;

function isStalePendingChat(turn: ChatTurn | undefined, now: number): boolean {
  if (!turn || turn.status !== "pending") return false;
  if (chatInFlight) return false;
  const startedAt = Date.parse(turn.created_at);
  if (!Number.isFinite(startedAt)) return true;
  return now - startedAt > STALE_PENDING_CHAT_MS;
}

// Kick a chat turn: persist a `pending` slot, fire the claude round-trip +
// change-apply fire-and-forget, and return immediately. Callers poll
// GET /v0/chat?since= to see it flip to `ready` (with reply + applied changes).
export async function startChatTurn(
  message: string,
  deps: ChatDeps,
): Promise<ChatOutcome> {
  const trimmed = message.trim();
  if (!trimmed) return { started: false, reason: "empty_message" };

  const state = await loadState(deps.stateFile);
  if (
    chatInFlight ||
    (state.last_chat?.status === "pending" &&
      !isStalePendingChat(state.last_chat, Date.now()))
  ) {
    return { started: false, reason: "in_flight", turnId: state.last_chat?.id };
  }

  chatInFlight = true;
  const turnId = newChatTurnId();
  const pending: ChatTurn = {
    id: turnId,
    created_at: new Date().toISOString(),
    status: "pending",
    message: trimmed,
  };
  try {
    await updateState(deps.stateFile, (s) => ({ ...s, last_chat: pending }));
  } catch (err) {
    chatInFlight = false;
    throw err;
  }

  // Fire-and-forget: runChatTurn lands a `failed` turn for model errors via its
  // own try/catch, but a throw in the persist/transcript tail (disk error, etc.)
  // would otherwise escape as an unhandled rejection — invisible to ops and a
  // process-crash risk under Node's default rejection handling. Log it so a
  // "my chat silently did nothing" report is diagnosable from stderr.
  void runChatTurn(trimmed, turnId, deps).catch((err) => {
    console.error(`[chat] runChatTurn ${turnId} failed to persist:`, err);
  });
  return { started: true, turnId };
}

export type ConfirmDeleteOutcome =
  | { ok: true; turn: ChatTurn }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "in_flight" };

// Confirm-gated delete (PER-230): the deterministic, no-model path that actually
// removes an interest after the user presses [Delete]. It writes a `ready` turn
// (with the delete in `changes`) to the same slot + transcript a model turn would,
// so the FE applies it through the exact same confirmed-write seam (flash + the
// docs-rail card disappears) and it survives a reload. Refuses while a model turn
// is in flight so the two writers can't clobber the interest set.
export async function confirmDeleteTurn(
  interestId: string,
  deps: ChatDeps,
): Promise<ConfirmDeleteOutcome> {
  if (chatInFlight) return { ok: false, reason: "in_flight" };

  // Hold the single-flight guard for the whole critical section. The check above
  // only refuses when a model turn is ALREADY running; without setting the flag
  // here a startChatTurn fired mid-confirm would pass its own `chatInFlight`
  // check and interleave its interest-set write with ours (last-writer-wins =
  // a silently dropped delete or dropped model change). Reset in `finally` so a
  // not_found early-return or a throw never wedges the flag on.
  chatInFlight = true;
  try {
    const state = await loadState(deps.stateFile);
    const pending = state.last_chat?.pending_delete;
    // The delete route is the stored proposal consumer, not a generic delete-by-id
    // API. This mirrors confirmRewriteTurn: stale cards or direct route calls must
    // not bypass the server-side confirmation state.
    if (!pending || pending.interestId !== interestId) {
      return { ok: false, reason: "not_found" };
    }

    // Reload before mutating + persisting so we don't clobber a concurrent writer
    // (e.g. a PUT /v0/interests that added a topic, or the scheduler updating
    // next_run_at), exactly as runChatTurn does. Splice the delete out of the
    // FRESH interest list, NOT the gate-time snapshot above — persisting the stale
    // post-delete list would silently revert any interest-set change that landed
    // between the two loads. Applying against `fresh` also makes a double-confirm
    // safe: the second call finds the interest already gone and 404s.
    const fresh = await loadState(deps.stateFile);
    const { applied } = await applyConfirmedDelete(
      fresh.interests ?? [],
      interestId,
      deps.interestsDir,
    );
    if (!applied) return { ok: false, reason: "not_found" };

    const turn: ChatTurn = {
      id: newChatTurnId(),
      created_at: new Date().toISOString(),
      status: "ready",
      message: `Delete "${applied.topic}"`,
      reply: `Removed "${applied.topic}" from your interests.`,
      changes: [applied],
    };

    await updateState(deps.stateFile, (s) => ({
      ...s,
      interests: replayChanges(s.interests ?? [], [applied]),
      last_chat: turn,
    }));
    // The delete is already durable in state.last_chat above; the transcript is a
    // secondary append-only record. A transient write failure here must NOT turn a
    // committed delete into a route-level 500 — the client's retry would 404 (the
    // pending_delete proposal is consumed), leaving the user with an error for an
    // operation that actually succeeded. Best-effort + logged, matching the
    // fire-and-forget transcript tail in runChatTurn / startChatTurn.
    await appendChatTranscript(turn, transcriptFileFor(deps)).catch((err) => {
      console.error(`[chat] confirm-delete transcript append failed:`, err);
    });
    deps.onChatDone?.(turn);
    return { ok: true, turn };
  } finally {
    chatInFlight = false;
  }
}

export type ConfirmRewriteOutcome =
  | { ok: true; turn: ChatTurn }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "in_flight" };

// Confirm-gated rewrite (PER-235): the deterministic, no-model path that writes
// the STORED proposed doc after the user presses [Apply]. The proposal lives on
// the persisted turn (`last_chat.pending_rewrite`) — the client sends only the
// interestId, never the doc, so a tampered or stale client can't write arbitrary
// content. Like confirmDeleteTurn it emits a `ready` turn (with the rewrite as
// an `update` in `changes`) into the same slot + transcript, so the FE applies
// it through the exact same confirmed-write seam (flash on the docs-rail card)
// and it survives a reload. Refuses while a model turn is in flight.
export async function confirmRewriteTurn(
  interestId: string,
  deps: ChatDeps,
): Promise<ConfirmRewriteOutcome> {
  if (chatInFlight) return { ok: false, reason: "in_flight" };

  // Hold the single-flight guard for the whole critical section — see the note in
  // confirmDeleteTurn. Without it a startChatTurn fired between this gate and the
  // saveState below would interleave its `last_chat` write with ours and could
  // resurrect the consumed pending_rewrite. Reset in `finally`.
  chatInFlight = true;
  try {
    const state = await loadState(deps.stateFile);
    const pending = state.last_chat?.pending_rewrite;
    // The proposal must still be the live one for THIS interest, and the interest
    // must still exist (it could have been deleted since the proposal).
    if (!pending || pending.interestId !== interestId) {
      return { ok: false, reason: "not_found" };
    }
    const target = (state.interests ?? []).find((i) => i.id === interestId);
    if (!target) return { ok: false, reason: "not_found" };

    await writeInterestDoc(interestId, pending.doc, deps.interestsDir);
    const applied: ChatChange = {
      interestId,
      op: "update",
      topic: target.topic,
      doc: pending.doc,
    };

    const turn: ChatTurn = {
      id: newChatTurnId(),
      created_at: new Date().toISOString(),
      status: "ready",
      message: `Apply rewrite of "${target.topic}"`,
      reply: `Applied the rewrite of "${target.topic}".`,
      changes: [applied],
    };

    // The new turn replaces the proposal turn in the slot, so the
    // pending_rewrite can't be re-applied later from a stale card (a second
    // confirm 404s).
    await updateState(deps.stateFile, (s) => ({ ...s, last_chat: turn }));
    // The rewrite is already durable: the doc was written above and the turn is in
    // state.last_chat. The transcript is a secondary record — a transient write
    // failure must NOT surface as a 500 for an operation that committed (the
    // client's retry would 404, the pending_rewrite being consumed). Best-effort +
    // logged, matching runChatTurn / startChatTurn's fire-and-forget tail.
    await appendChatTranscript(turn, transcriptFileFor(deps)).catch((err) => {
      console.error(`[chat] confirm-rewrite transcript append failed:`, err);
    });
    deps.onChatDone?.(turn);
    return { ok: true, turn };
  } finally {
    chatInFlight = false;
  }
}

async function runChatTurn(
  message: string,
  turnId: string,
  deps: ChatDeps,
): Promise<void> {
  let turn: ChatTurn;
  let applied: ChatChange[] = [];
  const abort = new AbortController();
  currentTurnAbort = { turnId, controller: abort };
  try {
    const state = await loadState(deps.stateFile);
    const snapshots = await buildInterestSnapshots(
      state.interests ?? [],
      deps.interestsDir,
    );
    const transcript = await readChatTranscriptCached(transcriptFileFor(deps));
    const output = await chatComplete(message, snapshots, transcript, {
      claudeBin: deps.claudeBin,
      spawnFn: deps.spawnFn,
      signal: abort.signal,
      timeoutMs: deps.timeoutMs,
    });
    // PER-232: last abort gate BEFORE anything persists. Even if the model
    // round-trip outraced the Stop (or the killed child still flushed output),
    // a stopped turn must commit nothing — this is AC3/AC5's "no uncommitted
    // change is written".
    abort.signal.throwIfAborted();
    // Apply against the freshly-loaded interest list so the change set is durable
    // on disk BEFORE the turn flips to `ready` (observable-in-same-response).
    // Deletes and full rewrites are gated: they come back as `pendingDeletes` /
    // `pendingRewrites` (NOT applied) for the FE to confirm. We surface the
    // first of each — the confirm cards are single-op.
    const result = await applyChatChanges(
      state.interests ?? [],
      output.changes,
      deps.interestsDir,
    );
    applied = result.applied;
    const { pendingDeletes, pendingRewrites } = result;
    turn = {
      id: turnId,
      created_at: new Date().toISOString(),
      status: "ready",
      message,
      reply: output.reply,
      changes: applied,
      ...(pendingDeletes.length > 0
        ? { pending_delete: pendingDeletes[0] }
        : {}),
      ...(pendingRewrites.length > 0
        ? { pending_rewrite: pendingRewrites[0] }
        : {}),
    };
  } catch (err) {
    turn = {
      id: turnId,
      created_at: new Date().toISOString(),
      status: "failed",
      message,
      // A user Stop is not an error — land the canonical message verbatim so
      // clients (and QA) can tell "stopped, nothing written" from a real failure.
      error_msg: abort.signal.aborted ? CHAT_STOPPED_MSG : String(err),
    };
  }

  try {
    // Replay this turn's changes onto the current list: the reader may have
    // saved interests while the model was answering.
    await updateState(deps.stateFile, (s) => ({
      ...s,
      interests:
        applied.length > 0
          ? replayChanges(s.interests ?? [], applied)
          : s.interests,
      last_chat: turn,
    }));
    await appendChatTranscript(turn, transcriptFileFor(deps));
  } finally {
    if (currentTurnAbort?.turnId === turnId) currentTurnAbort = null;
    chatInFlight = false;
  }

  deps.onChatDone?.(turn);
}
