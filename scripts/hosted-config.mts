// TEAM_RUNNER_TOKEN and SCOUT_WORKER_URL from ~/.config/scout-hosted/.env, read
// into a local object, never into process.env (that file holds other secrets
// a `claude` child must not see), and never printed. Used by `pnpm team:run`
// and the local gateway (scripts/team-run.mts, scripts/local-gateway.mts).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WANTED = new Set([
  "TEAM_RUNNER_TOKEN",
  "SCOUT_WORKER_URL",
  // The tailnet owner's login, for the gateway's automatic sign-in.
  "SCOUT_LOCAL_ALLOWED_LOGIN",
]);

export function readHostedConfig(
  file = join(homedir(), ".config/scout-hosted/.env"),
): Record<string, string> {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const config: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && WANTED.has(m[1]))
      config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return config;
}
