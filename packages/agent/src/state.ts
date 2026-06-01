// Persistent state for the loopback companion.
//
// We deliberately keep this in a single JSON file so users can inspect or
// delete it. There is no Supabase, no remote sync — everything lives at
// `~/.config/scout/state.json` with chmod 0600.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "scout");
export const STATE_FILE = path.join(CONFIG_DIR, "state.json");

export type Brief = {
  id: string;
  generated_at: string;
  status: "pending" | "ready" | "failed";
  summary_md?: string;
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

export type State = {
  pairing_token?: string;
  last_brief?: Brief;
  // Last interests the user submitted, persisted so the scheduler can run an
  // autonomous brief without the browser in the loop. Updated on every
  // POST /v0/interests.
  interests?: string[];
  schedule?: ScheduleConfig;
};

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
    return JSON.parse(raw) as State;
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
