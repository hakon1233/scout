// `pnpm team:run`: the Scout team runner's command line
// (packages/agent/src/team-runner.ts). Reads TEAM_RUNNER_TOKEN and
// SCOUT_WORKER_URL from ~/.config/scout-hosted/.env into a local object, never
// into process.env (that file holds other secrets the claude child must not
// see), and never prints them. See docs/ARCHITECTURE.md, "The Scout team runner".

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { teamRunMain } from "../packages/agent/src/team-runner.ts";
import {
  installTeamRunnerService,
  uninstallTeamRunnerService,
} from "../packages/agent/src/team-runner-service.ts";

const WANTED = new Set(["TEAM_RUNNER_TOKEN", "SCOUT_WORKER_URL"]);

function readConfig(): Record<string, string> {
  let text = "";
  try {
    text = readFileSync(join(homedir(), ".config/scout-hosted/.env"), "utf8");
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

const argv = process.argv.slice(2);
const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..");

if (argv[0] === "install-service" || argv[0] === "uninstall-service") {
  console.log(
    argv[0] === "install-service"
      ? await installTeamRunnerService({ repoDir })
      : await uninstallTeamRunnerService({}),
  );
} else {
  // --loop stops after the current run on SIGTERM (launchd) or Ctrl-C.
  const stop = new AbortController();
  if (argv.includes("--loop"))
    for (const sig of ["SIGTERM", "SIGINT"] as const)
      process.once(sig, () => stop.abort());
  process.exitCode = await teamRunMain(argv, process.env, readConfig(), {
    signal: stop.signal,
  });
}
