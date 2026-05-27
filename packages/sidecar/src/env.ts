// Load a tiny dotenv-ish file from ~/.scout-sidecar/.env so QA can drop the
// Exa key in one place. Nothing fancy — only KEY=VALUE lines, no quotes, no
// interpolation. We deliberately do not depend on `dotenv` to keep this
// package zero-dep at runtime.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SIDECAR_CONFIG_DIR = path.join(os.homedir(), ".scout-sidecar");
export const SIDECAR_ENV_FILE = path.join(SIDECAR_CONFIG_DIR, ".env");

export async function loadSidecarEnv(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(SIDECAR_ENV_FILE, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function resolveExaKey(): Promise<string | null> {
  if (process.env.EXA_API_KEY && process.env.EXA_API_KEY.trim()) {
    return process.env.EXA_API_KEY.trim();
  }
  const file = await loadSidecarEnv();
  const key = file.EXA_API_KEY?.trim();
  return key || null;
}
