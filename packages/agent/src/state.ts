// Persistent state for the loopback companion.
//
// We deliberately keep this in a single JSON file so users can inspect or
// delete it. There is no Supabase, no remote sync — everything lives at
// `~/.config/scout/state.json` with chmod 0600.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { TopicCoverage } from "./coverage.js";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "scout");
export const STATE_FILE = path.join(CONFIG_DIR, "state.json");

export type Brief = {
  id: string;
  generated_at: string;
  status: "pending" | "ready" | "failed";
  summary_md?: string;
  error_msg?: string;
  // Per-topic coverage, computed by the companion over the FULL interest list
  // when a brief lands (PER-154). Lets the UI honestly distinguish "no news
  // today" (empty) from "the model dropped this topic" (missing) instead of
  // reverse-parsing headings client-side with a brittle case-sensitive match.
  topics?: TopicCoverage[];
};

export type { TopicCoverage } from "./coverage.js";

// One change a chat turn applied to the interest collection (PER-172 / C4). The
// chat session manages the WHOLE set of interests, so a single turn can create a
// new interest (+ its doc), refine an existing interest's doc/topic, or delete an
// interest. `interestId` is always the concrete (server-assigned, for create) id
// the change landed on, so the UI can re-`GET /v0/interests` or update in place
// without guessing. This is the machine-readable change set the CEO contract
// (comment e81f2c2a) requires alongside the assistant reply, and the seam where
// C5's FE "Updated" beat fires only on a CONFIRMED write (PER-139 no-dead-control).
export type ChatChange = {
  interestId: string;
  op: "create" | "update" | "delete";
  // Present for create/update; the interest's (possibly renamed) topic.
  topic?: string;
  // The full markdown doc as persisted, for create/update. Absent on delete.
  doc?: string;
};

// One chat turn, held in a single last-writer-wins slot (`State.last_chat`) that
// mirrors `last_brief`. A turn is kicked async (POST /v0/chat) and polled
// (GET /v0/chat?since=) the same way briefs are, so the UI never blocks on the
// ~claude round-trip. The `changes` are applied to the doc store + state BEFORE
// the turn flips to `ready`, so a `ready` turn's change set is always already
// durable on disk (the "observable in the same response" contract).
export type ChatTurn = {
  id: string;
  created_at: string;
  status: "pending" | "ready" | "failed";
  // The user's message (echoed so a reconnecting poller has the full exchange).
  message: string;
  // The assistant's conversational reply (present once ready).
  reply?: string;
  // The change set actually applied this turn (present once ready; [] when the
  // turn only answered a question without touching any doc).
  changes?: ChatChange[];
  error_msg?: string;
};

// Persisted recurring-schedule config for the in-process scheduler (PER-151).
// `enabled` + `time_of_day` are user-writable (Settings UI / PUT /v0/schedule);
// the `last_run_*` / `next_run_at` fields are telemetry the scheduler maintains
// so the UI can show "last produced a brief at …" / "next fire …".
export type ScheduleConfig = {
  enabled: boolean;
  // Local wall-clock "HH:MM" (24h). Scheduler fires daily at this time.
  time_of_day: string;
  // ISO timestamp of the last SCHEDULED fire's outcome (not on-demand runs).
  last_run_at?: string;
  // success → a brief was produced; failed → synthesis errored; skipped → the
  // fire couldn't run (a run was already in flight, or no interests stored yet).
  last_run_status?: "success" | "failed" | "skipped";
  // Human-readable reason when last_run_status is "failed" or "skipped".
  last_run_note?: string;
  // ISO timestamp the scheduler computed for the next fire (null/absent when
  // disabled). The single writer is the scheduler's reschedule().
  next_run_at?: string;
};

// A single interest the user tracks. The `topic` is the short headline the
// research engine bullets into its prompt; the `id` is a stable, opaque handle
// that anchors the per-interest intent doc stored at
// `~/.config/scout/interests/<id>.md` (see docs.ts). The id survives reorders,
// adds, and removes so a doc never silently detaches from its topic. (PER-169)
export type Interest = {
  id: string;
  topic: string;
};

export type State = {
  pairing_token?: string;
  last_brief?: Brief;
  // Last interests the user submitted, persisted so the scheduler can run an
  // autonomous brief without the browser in the loop. Updated on every
  // POST/PUT /v0/interests. Stored as rich {id, topic} objects (PER-169); a
  // legacy `string[]` on disk is migrated to this shape on load — see
  // `migrateInterests` / `loadState`.
  interests?: Interest[];
  schedule?: ScheduleConfig;
  // Single chat-turn slot (last-writer-wins), mirroring `last_brief`. The chat
  // that manages the interest collection (PER-172) kicks a turn here and polls
  // it to `ready`. One slot is enough: the UI shows the latest turn's reply +
  // applied changes; the durable record of WHAT changed lives in the docs/state
  // the turn already wrote.
  last_chat?: ChatTurn;
};

// Mint a fresh, opaque, filename-safe interest id. Random (not derived from the
// topic) so the id — and the doc attached to it — survives a topic rename.
export function newInterestId(): string {
  return `int_${crypto.randomBytes(12).toString("hex")}`;
}

// Deterministic id for a LEGACY (string[]) interest being migrated. Derived from
// the topic so that re-loading an unpersisted legacy state.json yields the SAME
// id every time (a random id would drift on each load until the first save,
// which would make GET /v0/interests and any future doc path non-stable). Once a
// save lands, the id is canonicalized into the persisted {id, topic}. (PER-169)
export function legacyInterestId(topic: string): string {
  const h = crypto
    .createHash("sha256")
    .update(topic.trim().toLowerCase())
    .digest("hex");
  return `int_${h.slice(0, 24)}`;
}

// Normalize whatever is stored under `interests` into the rich {id, topic} shape.
// Accepts the legacy `string[]` (each string → {legacyId, topic}) and the new
// object form (passed through, dropping malformed entries). Lossless for legacy
// data: every non-empty topic string survives with a stable id. Pure so it can
// be unit-tested without the filesystem.
export function migrateInterests(raw: unknown): Interest[] {
  if (!Array.isArray(raw)) return [];
  const out: Interest[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string") {
      const topic = entry.trim();
      if (!topic) continue;
      let id = legacyInterestId(topic);
      // Defend against the (degenerate) case of two legacy strings hashing to
      // the same id — keep both by suffixing, so migration never drops a topic.
      while (seenIds.has(id)) id = `${id}_`;
      seenIds.add(id);
      out.push({ id, topic });
    } else if (entry && typeof entry === "object") {
      const obj = entry as { id?: unknown; topic?: unknown };
      const topic = typeof obj.topic === "string" ? obj.topic.trim() : "";
      if (!topic) continue;
      let id =
        typeof obj.id === "string" && obj.id.trim()
          ? obj.id.trim()
          : legacyInterestId(topic);
      while (seenIds.has(id)) id = `${id}_`;
      seenIds.add(id);
      out.push({ id, topic });
    }
  }
  return out;
}

// The plain topic strings, in order — what the research engine bullets into its
// prompt. Single boundary between the rich state model and the topic-only engine.
export function interestTopics(interests: Interest[] | undefined): string[] {
  return (interests ?? []).map((i) => i.topic);
}

// Reconcile a validated, ordered list of topic strings (what the FE sends over
// the wire — it has no ids yet) against the existing rich interests, preserving
// each existing topic's id so its intent doc stays attached across reorder / add
// / remove. New topics get a fresh random id. Pure + filesystem-free. (PER-169)
export function reconcileInterests(
  existing: Interest[] | undefined,
  topics: string[],
): Interest[] {
  const byTopic = new Map<string, string>();
  for (const it of existing ?? []) byTopic.set(it.topic.toLowerCase(), it.id);
  const usedIds = new Set<string>();
  return topics.map((topic) => {
    const key = topic.toLowerCase();
    let id = byTopic.get(key);
    if (!id || usedIds.has(id)) id = newInterestId();
    usedIds.add(id);
    return { id, topic };
  });
}

// Default time-of-day for the daily schedule when none is stored yet.
export const DEFAULT_TIME_OF_DAY = "07:00";

// The schedule we materialize on first load when none is persisted. We default
// `enabled: true` because the whole feature IS the founder's opt-in ("schedule
// a run for the research") and the goal is briefs "without the founder doing
// anything". The run is still gated on interests existing — a fire with no
// stored interests records a "skipped" telemetry entry and spawns nothing — so
// nothing is spent until the app has been used at least once. The UI (PER-152)
// exposes the toggle to turn it off.
export function defaultSchedule(): ScheduleConfig {
  return { enabled: true, time_of_day: DEFAULT_TIME_OF_DAY };
}

// Validate + normalize a "HH:MM" 24h string. Returns the normalized value
// (zero-padded) or null if malformed / out of range.
export function normalizeTimeOfDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export async function loadState(file = STATE_FILE): Promise<State> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as State;
    // Normalize interests to the rich {id, topic} shape on every load so the
    // rest of the system never sees the legacy `string[]`. Migration is pure and
    // lossless (see migrateInterests); the canonicalized ids are persisted on the
    // next save. Leave `interests` absent (not []) when it was absent, so the
    // "no interests stored yet" path stays distinguishable.
    if (parsed.interests !== undefined) {
      parsed.interests = migrateInterests(parsed.interests);
    }
    return parsed;
  } catch {
    return {};
  }
}

export async function saveState(state: State, file = STATE_FILE): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function newPairingToken(): string {
  // 32 bytes of entropy, base64url. Compact, copy-pasteable, opaque.
  return crypto.randomBytes(32).toString("base64url");
}

export function newBriefId(): string {
  return crypto.randomUUID();
}

export function newChatTurnId(): string {
  return crypto.randomUUID();
}

export type PairResolution = {
  token: string;
  // true when a brand-new token was minted (first pairing, or a forced rotation).
  // false when an existing token was reused unchanged.
  rotated: boolean;
};

// Decide which token a `pair` invocation should persist. Pure + side-effect free
// so it can be unit-tested without touching the filesystem. With `force`, always
// mint a fresh token (rotation); otherwise reuse an existing token if present.
export function resolvePairingToken(state: State, force = false): PairResolution {
  if (state.pairing_token && !force) {
    return { token: state.pairing_token, rotated: false };
  }
  return { token: newPairingToken(), rotated: true };
}
