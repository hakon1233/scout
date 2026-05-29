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

export type State = {
  pairing_token?: string;
  last_brief?: Brief;
};

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
