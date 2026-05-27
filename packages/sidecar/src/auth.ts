// Resolve the Claude Code OAuth bearer that `claude login` stores in the macOS
// keychain (service: "Claude Code-credentials"). On other OSes we fall back to
// the legacy `~/.claude/.credentials.json` location.
//
// We cache the parsed token in-memory for `CACHE_TTL_MS` so we don't shell out
// to `security(1)` on every request. The keychain read prompts the user only
// the first time, after which macOS grants the `security` binary access.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_TTL_MS = 60_000;
const KEYCHAIN_SERVICE = "Claude Code-credentials";

type CachedToken = { token: string; expiresAt: number | null; fetchedAt: number };
let cached: CachedToken | null = null;

export type ClaudeCreds = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

async function runSecurity(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  return await new Promise<string | null>((resolve) => {
    const child = spawn("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        if (stderr) console.error(`[sidecar] security exited ${code}: ${stderr.trim().slice(0, 200)}`);
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function readCredentialsFile(): Promise<string | null> {
  const candidate = path.join(os.homedir(), ".claude", ".credentials.json");
  try {
    return await fs.readFile(candidate, "utf8");
  } catch {
    return null;
  }
}

function parseCreds(raw: string): ClaudeCreds | null {
  try {
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function getClaudeOAuthToken(): Promise<ClaudeCreds> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    if (!cached.expiresAt || cached.expiresAt > now + 30_000) {
      return { accessToken: cached.token, expiresAt: cached.expiresAt ?? undefined };
    }
  }

  const raw = (await runSecurity()) ?? (await readCredentialsFile());
  if (!raw) {
    throw new Error(
      "Could not read Claude Code credentials. Run `claude login` once on this machine.",
    );
  }
  const creds = parseCreds(raw);
  if (!creds) {
    throw new Error(
      "Claude Code credentials present but unparseable. Try `claude login` again.",
    );
  }
  if (creds.expiresAt && creds.expiresAt < now + 30_000) {
    throw new Error(
      "Claude Code OAuth token expired. Run `claude login` to refresh it.",
    );
  }
  cached = {
    token: creds.accessToken,
    expiresAt: creds.expiresAt ?? null,
    fetchedAt: now,
  };
  return creds;
}

export function clearCachedToken(): void {
  cached = null;
}
