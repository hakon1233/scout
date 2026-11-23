// The local Scout gateway on the Mac (docs/ARCHITECTURE.md, "Local Scout on the
// Mac"): one origin on 127.0.0.1:47900 that serves the built site
// (local-server.mjs) and sends the app's Worker calls to the real Worker, with
// a local account's chat and publish answered by the Mac's `claude`
// (packages/agent/src/local-relay.ts). The Mac build points the app's Worker
// URL at this origin, so the app's code is the hosted one, unchanged.
//
// Usage: tsx --conditions=source scripts/local-gateway.mts <site dir> [port]
// Reads TEAM_RUNNER_TOKEN and SCOUT_WORKER_URL from ~/.config/scout-hosted/.env
// (hosted-config.mts); never prints them. `pnpm local:serve` runs it as a
// launchd job.

import { createWorkerProxy } from "../packages/agent/src/local-relay.ts";
import { readHostedConfig } from "./hosted-config.mts";
import { LOCAL_PORT, startLocalServer } from "./local-server.mjs";

const [root, portArg] = process.argv.slice(2);
if (!root) throw new Error("usage: local-gateway.mts <site dir> [port]");
const config = readHostedConfig();
const token = process.env.TEAM_RUNNER_TOKEN ?? config.TEAM_RUNNER_TOKEN;
const workerUrl = process.env.SCOUT_WORKER_URL ?? config.SCOUT_WORKER_URL;
if (!token || !workerUrl)
  throw new Error(
    "Set TEAM_RUNNER_TOKEN and SCOUT_WORKER_URL in ~/.config/scout-hosted/.env.",
  );
const port = portArg ? Number(portArg) : LOCAL_PORT;
await startLocalServer({
  root,
  port,
  proxy: createWorkerProxy({ workerUrl, token }),
});
console.log(`Scout on http://127.0.0.1:${port}/ (Worker calls relayed)`);
