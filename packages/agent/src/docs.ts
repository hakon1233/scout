// Per-interest intent-doc store (PER-169).
//
// Each interest (see `Interest` in state.ts) can have one prose "intent doc"
// that spells out *exactly* what the user wants from that topic — the captured
// intent that C2 injects into the topic's research prompt. We keep these as
// individual `.md` files (one per interest id) rather than inline in state.json
// so the user can read/edit/delete them with any editor, and so a large doc
// never bloats the hot state file.
//
// Storage: `~/.config/scout/interests/<id>.md`, reusing the exact fs hardening
// state.ts applies to state.json — dir `mkdir {recursive, mode: 0o700}`, file
// `writeFile {mode: 0o600}` — so docs are owner-only, same as everything else
// under ~/.config/scout.

import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./state.js";

export const INTERESTS_DIR = path.join(CONFIG_DIR, "interests");

// Interest ids are minted by state.ts (`newInterestId` → `int_<hex>`,
// `legacyInterestId` → `int_<sha256>`), so they're always this charset. We still
// validate before touching the filesystem: the id becomes a filename, and a
// malformed/hostile id (path separators, `..`) must never escape INTERESTS_DIR.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`unsafe interest id: ${JSON.stringify(id)}`);
  }
}

export function interestDocPath(id: string, dir = INTERESTS_DIR): string {
  assertSafeId(id);
  return path.join(dir, `${id}.md`);
}

// Persist (create or overwrite) the intent doc for an interest. Mirrors
// saveState's hardening so the doc is owner-only.
export async function writeInterestDoc(
  id: string,
  content: string,
  dir = INTERESTS_DIR,
): Promise<void> {
  const file = interestDocPath(id, dir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(file, content, { mode: 0o600 });
}

// Load an interest's intent doc. Returns null when none exists (never throws on
// a missing doc — "no doc yet" is a normal state, not an error).
export async function readInterestDoc(
  id: string,
  dir = INTERESTS_DIR,
): Promise<string | null> {
  try {
    return await fs.readFile(interestDocPath(id, dir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Remove an interest's doc (e.g. the interest was deleted). Idempotent: a
// missing doc is a no-op, not an error.
export async function deleteInterestDoc(
  id: string,
  dir = INTERESTS_DIR,
): Promise<void> {
  try {
    await fs.unlink(interestDocPath(id, dir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

// A deterministic default intent doc synthesized from a topic string (C2/PER-171).
//
// The six live interests predate the doc store, so most ids have no `.md` yet.
// Rather than research with an empty doc — which would make the per-interest
// session indistinguishable from the old topic-only one — we backfill a seed
// doc the first time a docless interest is researched. This is intentionally a
// pure string template, NOT an LLM call: C2 must stay deterministic + unit-
// testable, and real intent refinement is the chat flow's job (C4/C5). The seed
// is plain prose the user can later edit; editing it changes the next run's
// prompt (the PER-139 no-dead-control invariant the whole epic turns on).
export function defaultInterestDoc(topic: string): string {
  const t = topic.trim();
  return [
    `# ${t}`,
    "",
    `Track recent, notable developments about **${t}**. Surface concrete news —`,
    `announcements, releases, research, and reporting — favoring the last 7 days`,
    `and primary sources. Skip evergreen background and explainers unless they're`,
    `tied to something that just happened.`,
    "",
  ].join("\n");
}

// Return an interest's intent doc, lazily backfilling + PERSISTING a deterministic
// default (defaultInterestDoc) the first time a topic is researched without one
// (C2/PER-171). After this resolves, a doc file always exists on disk for `id`,
// so the hard invariant holds even for interests that predate the doc store:
// the doc the research prompt injects is the same bytes a user would see and
// edit. An empty/whitespace-only file is treated as "no doc" and reseeded.
export async function ensureInterestDoc(
  id: string,
  topic: string,
  dir = INTERESTS_DIR,
): Promise<string> {
  const existing = await readInterestDoc(id, dir);
  if (existing && existing.trim()) return existing;
  const seed = defaultInterestDoc(topic);
  await writeInterestDoc(id, seed, dir);
  return seed;
}

// Lightweight existence + last-modified metadata for an interest's doc, read
// straight from the filesystem so it can never drift from the actual file. The
// file is the single source of truth for `hasDoc` / `updatedAt` — we deliberately
// do NOT mirror these into state.json. `updatedAt` is the doc's mtime as an ISO
// string. (Feeds GET /v0/interests → the profile doc-indicator, PER-169/PER-170.)
export type InterestDocMeta = { hasDoc: boolean; updatedAt?: string };

export async function interestDocMeta(
  id: string,
  dir = INTERESTS_DIR,
): Promise<InterestDocMeta> {
  try {
    const st = await fs.stat(interestDocPath(id, dir));
    return { hasDoc: true, updatedAt: st.mtime.toISOString() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { hasDoc: false };
    }
    throw err;
  }
}
