// Conversational interest manager (PER-172 / C4).
//
// ONE chat manages the WHOLE set of interest docs. A single turn can:
//   - create a new interest (+ its `<id>.md` intent doc),
//   - refine/rename an existing interest's doc/topic,
//   - delete an interest (+ its doc).
//
// We delegate the natural-language reasoning to a headless `claude` subprocess
// the EXACT same delegated way research.ts does: we spawn the CLI and feed the
// prompt over stdin. We NEVER read, env-pass, argv-pass, or forward the user's
// `sk-ant-oat01-…` OAuth token — `claude` self-auths from
// `~/.claude/credentials.json` (guarded by the PER-108 contract test).
//
// Unlike research, the subprocess touches NO filesystem and uses NO tools. It
// only reasons over the interest snapshot we hand it and returns a structured
// change set as JSON. THIS module is the trusted applier: it validates each
// change against the current interest set, mints ids server-side (a model must
// never invent an `int_…` id, nor write an arbitrary `<id>.md`), persists via the
// docs.ts / state.ts helpers, and only then flips the turn to `ready`. That keeps
// the change set machine-readable AND makes the doc edit observable in the same
// turn (CEO contract e81f2c2a) — and a created/deleted interest also lands in
// `state.interests`, which a model editing files alone could never accomplish.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  loadState,
  saveState,
  newChatTurnId,
  newInterestId,
  type ChatChange,
  type ChatTurn,
  type Interest,
  type PendingDelete,
  type PendingRewrite,
} from "./state.js";
import { atomicWriteFile, CONFIG_DIR } from "./persistence.js";
import {
  readInterestDoc,
  writeInterestDoc,
  deleteInterestDoc,
} from "./docs.js";

// No tools: the chat subprocess only reasons and returns JSON. We still pass
// --dangerously-skip-permissions (as research does) so a stray tool attempt
// can't hang waiting on an interactive permission prompt in --print mode; the
// empty allow-list means there is nothing to invoke anyway.
const ALLOWED_TOOLS = "";

// Same niceness hedge as research.ts: keep the CPU-heavy child from starving the
// single-threaded loopback event loop so polls/healthz stay responsive.
const CHAT_CHILD_NICENESS = 10;

// Hard ceiling on interests, matching parseInterestsPayload's max-6 in server.ts.
// A chat "create" past the cap is dropped (and called out in the prompt context)
// so the collection can't grow unbounded via conversation.
export const MAX_INTERESTS = 6;

export type ChatOptions = {
  claudeBin?: string;
  // Spawn override for tests — injects a stub `claude` without the real binary
  // or network, exactly like ResearchOptions.spawnFn.
  spawnFn?: typeof spawn;
  // Abort signal (PER-232): when fired, the `claude` child is killed and the
  // round-trip rejects, so the turn can land as stopped WITHOUT applying changes.
  signal?: AbortSignal;
};

// What the model is asked to return: a reply plus the changes it wants applied.
// `interestId` is omitted on create (the system assigns it). We validate this
// shape defensively before trusting any field.
type ProposedChange = {
  op?: unknown;
  interestId?: unknown;
  topic?: unknown;
  doc?: unknown;
};
type ChatModelOutput = {
  reply: string;
  changes: ProposedChange[];
};

// Snapshot of an interest handed to the model: its id, topic, and current doc so
// the model can "read" the doc before proposing an edit.
type InterestSnapshot = { id: string; topic: string; doc: string };

const CHAT_CONTEXT_TURN_LIMIT = 20;

export function defaultChatTranscriptFile(stateFile?: string): string {
  return path.join(
    stateFile ? path.dirname(stateFile) : CONFIG_DIR,
    "chat",
    "transcript.json",
  );
}

export async function readChatTranscript(
  file = defaultChatTranscriptFile(),
): Promise<ChatTurn[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[chat] transcript ${file} could not be read:`, err);
    }
    // No transcript yet (ENOENT) is the normal first-run state. Other read
    // failures still degrade gracefully, but are logged so they are diagnosable.
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The file exists and was readable but holds corrupt JSON. Returning [] here
    // is the dangerous case: the very next appendChatTranscript would overwrite
    // this file, permanently destroying whatever history it still held. Move the
    // corrupt bytes aside first so the user's history stays recoverable, THEN
    // start fresh. Best-effort — if the backup itself fails we still return [].
    await preserveCorruptTranscript(file);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is ChatTurn => {
    if (!entry || typeof entry !== "object") return false;
    const turn = entry as Partial<ChatTurn>;
    return (
      typeof turn.id === "string" &&
      typeof turn.created_at === "string" &&
      typeof turn.message === "string" &&
      (turn.status === "pending" ||
        turn.status === "ready" ||
        turn.status === "failed")
    );
  });
}

// Rename a corrupt transcript to a timestamped `.corrupt-<ts>.bak` sibling so the
// next write starts from a clean file without erasing the unparseable original.
// Pure best-effort: any failure is swallowed (we log and fall back to truncation,
// which is no worse than the pre-existing behavior).
async function preserveCorruptTranscript(file: string): Promise<void> {
  try {
    const backup = `${file}.corrupt-${Date.now()}.bak`;
    await fs.rename(file, backup);
    console.error(
      `[chat] transcript ${file} was corrupt; preserved at ${backup} and started fresh`,
    );
  } catch (err) {
    console.error(`[chat] transcript ${file} was corrupt and could not be backed up:`, err);
  }
}

async function writeChatTranscript(
  turns: ChatTurn[],
  file = defaultChatTranscriptFile(),
): Promise<void> {
  // Atomic temp+rename (shared with state.json): a plain writeFile that tears
  // mid-write leaves corrupt JSON. The rename can never expose a half-written
  // transcript, and if a transcript is ever found corrupt anyway readChatTranscript
  // moves it aside to a `.corrupt-*.bak` rather than letting this write wipe it.
  await atomicWriteFile(file, JSON.stringify(turns, null, 2));
}

async function appendChatTranscript(
  turn: ChatTurn,
  file = defaultChatTranscriptFile(),
): Promise<void> {
  const turns = await readChatTranscript(file);
  const idx = turns.findIndex((t) => t.id === turn.id);
  if (idx === -1) turns.push(turn);
  else turns[idx] = turn;
  turns.sort((a, b) => a.created_at.localeCompare(b.created_at));
  await writeChatTranscript(turns, file);
}

export async function buildInterestSnapshots(
  interests: Interest[],
  interestsDir: string,
): Promise<InterestSnapshot[]> {
  return await Promise.all(
    interests.map(async (it) => ({
      id: it.id,
      topic: it.topic,
      doc: (await readInterestDoc(it.id, interestsDir)) ?? "",
    })),
  );
}

export function buildChatPrompt(
  message: string,
  snapshots: InterestSnapshot[],
  transcript: ChatTurn[] = [],
): string {
  const lines: string[] = [];
  lines.push(
    "You are Scout's interest assistant. Through conversation you help the user",
  );
  lines.push(
    "manage their personalized-news interests. There is ONE chat for the WHOLE",
  );
  lines.push("set of interests — not one chat per interest.");
  lines.push("");
  lines.push("Each interest has:");
  lines.push("- an `id`: an opaque, stable handle (do NOT invent new ids),");
  lines.push("- a `topic`: the short headline the news engine searches on,");
  lines.push(
    "- a `doc`: free-form markdown capturing EXACTLY what the user wants from that",
  );
  lines.push(
    "  topic. This doc is injected verbatim into the topic's research prompt, so",
  );
  lines.push("  refining it directly changes what the next brief researches.");
  lines.push("");
  lines.push(
    `Current interests (${snapshots.length} of a maximum of ${MAX_INTERESTS}), as JSON:`,
  );
  lines.push("```json");
  lines.push(JSON.stringify(snapshots, null, 2));
  lines.push("```");
  lines.push("");
  const contextTurns = transcript
    .filter((turn) => turn.status === "ready" || turn.status === "failed")
    .slice(-CHAT_CONTEXT_TURN_LIMIT);
  if (contextTurns.length > 0) {
    lines.push(
      `Recent conversation (${contextTurns.length} prior turns, oldest first):`,
    );
    lines.push("```json");
    lines.push(
      JSON.stringify(
        contextTurns.map((turn) => ({
          user: turn.message,
          assistant:
            turn.status === "ready"
              ? (turn.reply ?? "")
              : `[failed: ${turn.error_msg ?? "unknown error"}]`,
          changes: turn.changes ?? [],
        })),
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("");
  }
  lines.push("The user says:");
  lines.push('"""');
  lines.push(message);
  lines.push('"""');
  lines.push("");
  lines.push(
    "Decide what changes (if any) to make to the interests, then reply to the user.",
  );
  lines.push("");
  lines.push(
    "Respond with a SINGLE JSON object and NOTHING else (no prose, no code fence):",
  );
  lines.push("{");
  lines.push('  "reply": "<your short conversational reply to the user>",');
  lines.push('  "changes": [');
  lines.push("    // Refine or replace an existing interest's intent doc:");
  lines.push(
    '    { "op": "update", "interestId": "<existing id>", "doc": "<full new markdown>" },',
  );
  lines.push("    // Add a topic rename by also including a topic field:");
  lines.push(
    '    { "op": "update", "interestId": "<existing id>", "topic": "<new topic>", "doc": "<full markdown>" },',
  );
  lines.push(
    "    // Create a new interest (do NOT supply an id — the system mints it):",
  );
  lines.push(
    '    { "op": "create", "topic": "<topic>", "doc": "<full markdown>" },',
  );
  lines.push(
    "    // Completely rewrite an interest's doc from scratch (full replacement):",
  );
  lines.push(
    '    { "op": "rewrite", "interestId": "<existing id>", "doc": "<full new markdown>" },',
  );
  lines.push("    // Delete an interest:");
  lines.push('    { "op": "delete", "interestId": "<existing id>" }');
  lines.push("  ]");
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push(
    "- Include ONLY the changes you are actually making this turn; use [] when none.",
  );
  lines.push(
    '- For "update"/"rewrite"/"delete", `interestId` MUST be one of the ids listed above.',
  );
  lines.push('- For "create", OMIT `interestId`; never invent one.');
  lines.push(
    "- `doc` must be the COMPLETE new document, never a diff or fragment.",
  );
  lines.push(
    `- There is a hard cap of ${MAX_INTERESTS} interests; don't create past it.`,
  );
  lines.push(
    "- Choosing the op is important. If the user wants to REMOVE a topic from",
  );
  lines.push(
    '    their interests — "delete X", "remove X", "drop X", "get rid of X", "stop',
  );
  lines.push(
    '    tracking X", "I no longer care about X" — emit a `delete` op for that',
  );
  lines.push(
    "    interest's id. Deleting is the ONLY way to remove an interest: NEVER try to",
  );
  lines.push(
    '    "remove" it by emptying, blanking, or rewriting its `doc` with an `update` —',
  );
  lines.push(
    "    an update keeps the interest alive and still feeds the next brief. Reserve",
  );
  lines.push(
    "    `update` for when the user wants to KEEP the topic but change what it tracks.",
  );
  lines.push(
    "- A `delete` is CONFIRM-GATED: emitting it does NOT remove the interest. The user",
  );
  lines.push(
    "    still has to press [Delete] on a confirmation card. So when your changes include",
  );
  lines.push(
    '    a `delete`, phrase `reply` as a PENDING REQUEST, never as a completed action.',
  );
  lines.push(
    '    Say e.g. "Delete \\"X\\"? Confirm below — this would bring you to N of 6 interests."',
  );
  lines.push(
    '    NEVER claim it is done ("Done — deleted", "Removed X", "You\'re back to N") on a',
  );
  lines.push(
    "    delete turn; the interest is still there until the user confirms. Create/update",
  );
  lines.push("    apply immediately, so for those a done-style reply is correct.");
  lines.push(
    "- A `rewrite` is for a FULL from-scratch replacement of an interest's doc — the",
  );
  lines.push(
    '    user asks to "completely rewrite", "start over", "rewrite from scratch", or',
  );
  lines.push(
    "    otherwise wants the WHOLE doc replaced rather than refined. Like `delete`, a",
  );
  lines.push(
    "    `rewrite` is CONFIRM-GATED: emitting it does NOT change the doc. The user still",
  );
  lines.push(
    "    has to press [Apply] on a proposal card showing the diff. `doc` MUST be the",
  );
  lines.push(
    "    COMPLETE proposed document. When your changes include a `rewrite`, phrase",
  );
  lines.push(
    '    `reply` as a PENDING PROPOSAL, never as a completed action. Say e.g. "Here\'s',
  );
  lines.push(
    '    a full rewrite of \\"X\\" — review the diff and Apply below." NEVER claim it is',
  );
  lines.push(
    '    done ("Done — rewrote it", "Updated X") on a rewrite turn; the doc is unchanged',
  );
  lines.push(
    "    until the user applies. Reserve `update` for incremental refinements the user",
  );
  lines.push(
    "    asked to make directly — those still apply immediately.",
  );
  lines.push("- Do not use any tools. Output only the JSON object.");
  return lines.join("\n");
}

// Run the `claude` subprocess for one chat turn and parse its JSON output.
// Mirrors research.ts's delegated spawn (stdin prompt, niceness, error mapping)
// but expects a JSON object back instead of brief markdown.
export async function chatComplete(
  message: string,
  snapshots: InterestSnapshot[],
  transcript: ChatTurn[] = [],
  opts: ChatOptions = {},
): Promise<ChatModelOutput> {
  const claudeBin = opts.claudeBin ?? process.env.SCOUT_CLAUDE_BIN ?? "claude";
  const spawnImpl = opts.spawnFn ?? spawn;
  const prompt = buildChatPrompt(message, snapshots, transcript);

  const raw = await new Promise<string>((resolve, reject) => {
    if (opts.signal?.aborted) {
      return reject(new ChatStoppedError());
    }
    const child = spawnImpl(
      claudeBin,
      [
        "--print",
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
        "--allowed-tools",
        ALLOWED_TOOLS,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, CHAT_CHILD_NICENESS);
      } catch {
        // Advisory only — proceed without the niceness hedge.
      }
    }

    // PER-232: a Stop mid-round-trip kills the child and rejects immediately,
    // so the caller can mark the turn stopped instead of waiting out the model.
    // The stub children in tests have no kill(); guard with `?.`.
    const onAbort = () => {
      (child as { kill?: (sig?: string) => void }).kill?.("SIGTERM");
      reject(new ChatStoppedError());
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";
    // Decode through a StringDecoder so a multi-byte UTF-8 char (em dash,
    // accents, emoji) split across two `data` chunks isn't mangled into
    // replacement chars — chat replies and persisted intent docs carry such
    // characters routinely. Per-chunk Buffer.toString() corrupts any codepoint
    // straddling a chunk boundary.
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    child.stdout!.on("data", (b: Buffer) => (stdout += outDecoder.write(b)));
    child.stderr!.on("data", (b: Buffer) => (stderr += errDecoder.write(b)));
    child.on("error", (e) =>
      reject(
        new Error(
          `failed to spawn '${claudeBin}' — is the Claude Code CLI installed and on PATH? (${e.message})`,
        ),
      ),
    );
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      // Flush any bytes the decoder buffered for an incomplete trailing char.
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      if (opts.signal?.aborted) return reject(new ChatStoppedError());
      if (code !== 0)
        return reject(
          new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`),
        );
      resolve(stdout);
    });

    child.stdin!.write(prompt);
    child.stdin!.end();
  });

  return parseChatOutput(raw);
}

// Extract the JSON object from the model's text output and coerce it into the
// ChatModelOutput shape. Robust to a stray code fence or leading/trailing prose:
// we slice from the first `{` to the last `}`. Throws on anything unparseable so
// the turn lands as `failed` rather than silently dropping the user's edit.
export function parseChatOutput(raw: string): ChatModelOutput {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("chat model did not return a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error(`chat model returned invalid JSON: ${String(err)}`);
  }
  const obj = parsed as { reply?: unknown; changes?: unknown };
  const reply = typeof obj.reply === "string" ? obj.reply : "";
  const changes = Array.isArray(obj.changes)
    ? (obj.changes as ProposedChange[])
    : [];
  return { reply, changes };
}

// Apply the model's proposed changes to the doc store + interest list, returning
// the new interest list and the change set that ACTUALLY landed (with concrete,
// server-assigned ids). Every change is validated against `current`: an update or
// delete naming an id we don't hold is dropped (so the model can never write an
// arbitrary `<id>.md`), and a create past MAX_INTERESTS is dropped. The applied
// list — never the model's raw proposal — is what we return to the client, so the
// FE only ever sees confirmed writes (PER-139).
//
// PER-230: delete is the one DESTRUCTIVE op, so it is confirm-gated. A model
// `delete` is NOT applied here; it is collected into `pendingDeletes` and surfaced
// to the FE as a [Delete]/[Cancel] proposal. The interest stays alive until the
// user explicitly confirms via applyConfirmedDelete. create/update remain
// auto-apply (CEO decision on PER-230 — do not gate those).
//
// PER-235: a full from-scratch `rewrite` replaces the ENTIRE doc, so it is gated
// the same way: collected into `pendingRewrites` (with the FULL proposed doc),
// NOT written. The doc on disk stays byte-identical until the user presses
// [Apply], which routes through applyConfirmedRewrite.
export async function applyChatChanges(
  current: Interest[],
  proposed: ProposedChange[],
  interestsDir: string,
): Promise<{
  interests: Interest[];
  applied: ChatChange[];
  pendingDeletes: PendingDelete[];
  pendingRewrites: PendingRewrite[];
}> {
  const interests = [...current];
  const applied: ChatChange[] = [];
  const pendingDeletes: PendingDelete[] = [];
  const pendingRewrites: PendingRewrite[] = [];

  for (const ch of proposed) {
    const op = ch.op;
    if (op === "create") {
      const topic = typeof ch.topic === "string" ? ch.topic.trim() : "";
      if (!topic) continue;
      if (interests.length >= MAX_INTERESTS) continue;
      const id = newInterestId();
      const doc = typeof ch.doc === "string" ? ch.doc : "";
      interests.push({ id, topic });
      await writeInterestDoc(id, doc, interestsDir);
      applied.push({ interestId: id, op: "create", topic, doc });
    } else if (op === "update") {
      const id = typeof ch.interestId === "string" ? ch.interestId : "";
      const idx = interests.findIndex((i) => i.id === id);
      if (idx === -1) continue; // never touch an id we don't own
      const topic =
        typeof ch.topic === "string" && ch.topic.trim()
          ? ch.topic.trim()
          : interests[idx].topic;
      const doc =
        typeof ch.doc === "string"
          ? ch.doc
          : ((await readInterestDoc(id, interestsDir)) ?? "");
      interests[idx] = { id, topic };
      await writeInterestDoc(id, doc, interestsDir);
      applied.push({ interestId: id, op: "update", topic, doc });
    } else if (op === "rewrite") {
      const id = typeof ch.interestId === "string" ? ch.interestId : "";
      const idx = interests.findIndex((i) => i.id === id);
      if (idx === -1) continue; // never touch an id we don't own
      const doc = typeof ch.doc === "string" ? ch.doc : "";
      if (!doc.trim()) continue; // a rewrite without a full doc is meaningless
      // Confirm-gated (PER-235): propose with the FULL doc, do NOT write. Dedup
      // so a model that lists the same id twice still surfaces one card.
      if (!pendingRewrites.some((p) => p.interestId === id)) {
        pendingRewrites.push({
          interestId: id,
          topic: interests[idx].topic,
          doc,
        });
      }
    } else if (op === "delete") {
      const id = typeof ch.interestId === "string" ? ch.interestId : "";
      const idx = interests.findIndex((i) => i.id === id);
      if (idx === -1) continue;
      // Confirm-gated: propose, do NOT remove. Dedup so a model that lists the
      // same id twice still surfaces one card.
      if (!pendingDeletes.some((p) => p.interestId === id)) {
        pendingDeletes.push({ interestId: id, topic: interests[idx].topic });
      }
    }
  }

  return { interests, applied, pendingDeletes, pendingRewrites };
}

// Perform a confirmed delete (PER-230): the deterministic removal that runs only
// after the user presses [Delete] on the confirm card. No model involved — we
// validate the id is one we hold, splice it out, and delete its doc. Returns the
// applied delete change (for the FE to render + flash) or null if the interest is
// already gone (a double-confirm or a stale card → 404 at the route).
export async function applyConfirmedDelete(
  current: Interest[],
  interestId: string,
  interestsDir: string,
): Promise<{ interests: Interest[]; applied: ChatChange | null }> {
  const interests = [...current];
  const idx = interests.findIndex((i) => i.id === interestId);
  if (idx === -1) return { interests, applied: null };
  const [removed] = interests.splice(idx, 1);
  await deleteInterestDoc(interestId, interestsDir);
  return {
    interests,
    applied: { interestId, op: "delete", topic: removed.topic },
  };
}

export type ChatDeps = {
  stateFile: string;
  interestsDir: string;
  chatTranscriptFile?: string;
  claudeBin?: string;
  spawnFn?: typeof spawn;
  // Fired when a turn finishes (ready or failed). Tests await this.
  onChatDone?: (turn: ChatTurn) => void;
};

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
export const CHAT_STOPPED_MSG = "Stopped — no changes were applied.";

class ChatStoppedError extends Error {
  constructor() {
    super(CHAT_STOPPED_MSG);
    this.name = "ChatStoppedError";
  }
}

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
    await saveState({ ...state, last_chat: pending }, deps.stateFile);
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
    const { interests, applied } = await applyConfirmedDelete(
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

    await saveState({ ...fresh, interests, last_chat: turn }, deps.stateFile);
    // The delete is already durable in state.last_chat above; the transcript is a
    // secondary append-only record. A transient write failure here must NOT turn a
    // committed delete into a route-level 500 — the client's retry would 404 (the
    // pending_delete proposal is consumed), leaving the user with an error for an
    // operation that actually succeeded. Best-effort + logged, matching the
    // fire-and-forget transcript tail in runChatTurn / startChatTurn.
    await appendChatTranscript(turn, deps.chatTranscriptFile).catch((err) => {
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

    // Reload before persisting so we don't clobber a concurrent writer (e.g. the
    // scheduler updating next_run_at), exactly as runChatTurn does. The new turn
    // replaces the proposal turn in the slot, so the pending_rewrite can't be
    // re-applied later from a stale card (a second confirm 404s).
    const fresh = await loadState(deps.stateFile);
    await saveState({ ...fresh, last_chat: turn }, deps.stateFile);
    // The rewrite is already durable: the doc was written above and the turn is in
    // state.last_chat. The transcript is a secondary record — a transient write
    // failure must NOT surface as a 500 for an operation that committed (the
    // client's retry would 404, the pending_rewrite being consumed). Best-effort +
    // logged, matching runChatTurn / startChatTurn's fire-and-forget tail.
    await appendChatTranscript(turn, deps.chatTranscriptFile).catch((err) => {
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
  let nextInterests: Interest[] | null = null;
  const abort = new AbortController();
  currentTurnAbort = { turnId, controller: abort };
  try {
    const state = await loadState(deps.stateFile);
    const snapshots = await buildInterestSnapshots(
      state.interests ?? [],
      deps.interestsDir,
    );
    const transcript = await readChatTranscript(deps.chatTranscriptFile);
    const output = await chatComplete(message, snapshots, transcript, {
      claudeBin: deps.claudeBin,
      spawnFn: deps.spawnFn,
      signal: abort.signal,
    });
    // PER-232: last abort gate BEFORE anything persists. Even if the model
    // round-trip outraced the Stop (or the killed child still flushed output),
    // a stopped turn must commit nothing — this is AC3/AC5's "no uncommitted
    // change is written".
    if (abort.signal.aborted) throw new ChatStoppedError();
    // Apply against the freshly-loaded interest list so the change set is durable
    // on disk BEFORE the turn flips to `ready` (observable-in-same-response).
    // Deletes and full rewrites are gated: they come back as `pendingDeletes` /
    // `pendingRewrites` (NOT applied) for the FE to confirm. We surface the
    // first of each — the confirm cards are single-op.
    const { interests, applied, pendingDeletes, pendingRewrites } =
      await applyChatChanges(
        state.interests ?? [],
        output.changes,
        deps.interestsDir,
      );
    nextInterests = interests;
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
      error_msg:
        err instanceof ChatStoppedError ? CHAT_STOPPED_MSG : String(err),
    };
  }

  try {
    // Reload before persisting so we don't clobber a concurrent writer (e.g. the
    // scheduler updating next_run_at). Only overwrite `interests` when the turn
    // actually changed them.
    const fresh = await loadState(deps.stateFile);
    await saveState(
      {
        ...fresh,
        interests: nextInterests ?? fresh.interests,
        last_chat: turn,
      },
      deps.stateFile,
    );
    await appendChatTranscript(turn, deps.chatTranscriptFile);
  } finally {
    if (currentTurnAbort?.turnId === turnId) currentTurnAbort = null;
    chatInFlight = false;
  }

  deps.onChatDone?.(turn);
}
