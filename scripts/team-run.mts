// `pnpm team:run`: the Scout team runner's command line
// (packages/agent/src/team-runner.ts). Reads TEAM_RUNNER_TOKEN and
// SCOUT_WORKER_URL from ~/.config/scout-hosted/.env (hosted-config.mts), never
// into process.env, and never prints them. See docs/ARCHITECTURE.md, "The
// Scout team runner".

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { teamRunMain } from "../packages/agent/src/team-runner.ts";
import {
  installTeamRunnerService,
  uninstallTeamRunnerService,
} from "../packages/agent/src/team-runner-service.ts";
import { readHostedConfig } from "./hosted-config.mts";

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
  process.exitCode = await teamRunMain(argv, process.env, readHostedConfig(), {
    signal: stop.signal,
  });
}
