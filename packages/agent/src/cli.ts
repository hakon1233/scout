#!/usr/bin/env node
// @notiva/agent — local loopback companion CLI.
//
// Subcommands:
//   pair          Generate a local pairing token and print it. Paste it into the
//                 Notiva web Connect page to authorize the browser → loopback link.
//   run (default) Start the loopback HTTP server on 127.0.0.1.
//   status        Print pairing + last-brief state.
//
// Constraint: we MUST NOT transmit the user's Anthropic OAuth token
// (`sk-ant-oat01-…`) off-machine. Synthesis runs by spawning the user's local
// `claude` CLI; we never read or forward that token.

import { loadState, newPairingToken, saveState, STATE_FILE } from "./state.js";
import { PKG_VERSION, startServer } from "./server.js";

async function cmdPair(): Promise<void> {
  const state = await loadState();
  const token = state.pairing_token ?? newPairingToken();
  await saveState({ ...state, pairing_token: token });
  console.log("Pairing token (paste into the Notiva Connect page):\n");
  console.log(`  ${token}\n`);
  console.log(`Stored at ${STATE_FILE}. Run \`notiva-agent run\` to start the loopback server.`);
}

async function cmdStatus(): Promise<void> {
  const state = await loadState();
  if (!state.pairing_token) {
    console.log("not paired. run `notiva-agent pair` first.");
    return;
  }
  console.log(`paired (token: ${state.pairing_token.slice(0, 8)}…)`);
  console.log(`exa key: ${state.exa_key ? "configured" : "missing — add to state.json"}`);
  const b = state.last_brief;
  if (!b) console.log("no briefs yet.");
  else console.log(`last brief: ${b.status} @ ${b.generated_at} (${b.id})`);
}

async function cmdRun(portArg?: string): Promise<void> {
  const state = await loadState();
  if (!state.pairing_token) {
    console.error("not paired. run `notiva-agent pair` first.");
    process.exit(1);
  }
  const port = portArg ? Number(portArg) : Number(process.env.NOTIVA_AGENT_PORT ?? 0);
  const { port: bound } = await startServer(Number.isFinite(port) ? port : 0);
  console.log(`@notiva/agent v${PKG_VERSION} listening on http://127.0.0.1:${bound}`);
  console.log("Endpoints: GET /healthz, POST /v0/interests, GET /v0/briefs?since=<iso>");
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "pair":
        await cmdPair();
        break;
      case "status":
        await cmdStatus();
        break;
      case "run":
      case undefined: {
        const portFlagIdx = rest.indexOf("--port");
        const port = portFlagIdx >= 0 ? rest[portFlagIdx + 1] : undefined;
        await cmdRun(port);
        break;
      }
      default:
        console.error(`unknown command: ${cmd}. usage: notiva-agent [pair|run|status]`);
        process.exit(2);
    }
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

main();
