// The chat transcript: every finished turn, oldest first, in
// chat/transcript.json next to the state file. Read for the model's context and
// for GET /v0/chat; appended once per turn.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatTurn } from "./contract.js";
import {
  assertNotRealStateUnderTest,
  atomicWriteFile,
  CONFIG_DIR,
} from "./persistence.js";

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
    assertNotRealStateUnderTest(file);
    await fs.rename(file, backup);
    console.error(
      `[chat] transcript ${file} was corrupt; preserved at ${backup} and started fresh`,
    );
  } catch (err) {
    console.error(
      `[chat] transcript ${file} was corrupt and could not be backed up:`,
      err,
    );
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

// In-memory mirror of the on-disk transcript, keyed by file path (there is one
// live path per running companion process, but tests exercise many distinct
// tmp paths within a single process). appendChatTranscript is the ONLY writer
// of a live transcript file, so this cache can safely stand in for a fresh
// read+parse everywhere except `readChatTranscript` itself, which stays a true
// disk read for the corrupt-transcript recovery path and the tests exercising
// it directly. Populated lazily, updated only after a write actually commits
// (never optimistically) so a failed write can't leave the cache ahead of disk.
let transcriptCache: { file: string; turns: ChatTurn[] } | undefined;

// GET /v0/chat polls this every 1.2s while a turn is in flight (up to 120s,
// `src/lib/chat.ts`'s pollChatTurn); without this cache every poll tick paid a
// full disk read + JSON.parse + shape-validation of the whole, ever-growing
// transcript just to check one turn's status.
export async function readChatTranscriptCached(
  file = defaultChatTranscriptFile(),
): Promise<ChatTurn[]> {
  if (transcriptCache?.file === file) return transcriptCache.turns;
  const turns = await readChatTranscript(file);
  transcriptCache = { file, turns };
  return turns;
}

export async function appendChatTranscript(
  turn: ChatTurn,
  file = defaultChatTranscriptFile(),
): Promise<void> {
  const turns = [...(await readChatTranscriptCached(file))];
  const idx = turns.findIndex((t) => t.id === turn.id);
  if (idx === -1) turns.push(turn);
  else turns[idx] = turn;
  turns.sort((a, b) => a.created_at.localeCompare(b.created_at));
  await writeChatTranscript(turns, file);
  transcriptCache = { file, turns };
}
