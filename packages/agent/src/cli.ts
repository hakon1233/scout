#!/usr/bin/env node
// @scout/agent — local loopback companion CLI.
//
// Subcommands:
//   pair          Generate and store a local pairing token. No paste needed:
//                 `scout-agent run` serves the Scout UI from this loopback
//                 origin, so the browser auto-adopts the token same-origin
//                 (PER-110). Reuses an existing token if one is stored; pass
//                 --force (alias --reset) to mint a fresh token and invalidate
//                 the old one.
//   run (default) Start the loopback HTTP server on 127.0.0.1.
//   status        Print pairing + last-brief state.
//
// Constraint: we MUST NOT transmit the user's Anthropic OAuth token
// (`sk-ant-oat01-…`) off-machine. Synthesis runs by spawning the user's local
// `claude` CLI; we never read or forward that token.

import { loadState, resolvePairingToken, saveState, STATE_FILE } from "./state.js";
import { DEFAULT_PORT, PKG_VERSION, startServer } from "./server.js";

async function cmdPair(force: boolean): Promise<void> {
  const state = await loadState();
  const had = Boolean(state.pairing_token);
  const { token, rotated } = resolvePairingToken(state, force);
  await saveState({ ...state, pairing_token: token });

  if (had && !rotated) {
    console.log("Reusing existing pairing token (run `scout-agent pair --force` to rotate).\n");
  } else if (had && rotated) {
    console.log("Rotated pairing token — the previous token is now invalid.\n");
  }
  console.log("Pairing token (stored locally — no need to paste it anywhere):\n");
  console.log(`  ${token}\n`);
  console.log(`Stored at ${STATE_FILE}.`);
  console.log(
    "Next: run `scout-agent run`, then open the printed http://127.0.0.1 URL.\n" +
      "The Scout UI is served from this companion, so the browser adopts the token\n" +
      "automatically — no copy/paste step.",
  );
}

async function cmdStatus(): Promise<void> {
  const state = await loadState();
  if (!state.pairing_token) {
    console.log("not paired. run `scout-agent pair` first.");
    return;
  }
  console.log(`paired (token: ${state.pairing_token.slice(0, 8)}…)`);
  const b = state.last_brief;
  if (!b) console.log("no briefs yet.");
  else console.log(`last brief: ${b.status} @ ${b.generated_at} (${b.id})`);
}

async function cmdRun(portArg?: string): Promise<void> {
  const state = await loadState();
  if (!state.pairing_token) {
    console.error("not paired. run `scout-agent pair` first.");
    process.exit(1);
  }
  const port = portArg ? Number(portArg) : DEFAULT_PORT;
  const { port: bound } = await startServer(Number.isFinite(port) ? port : DEFAULT_PORT);
  const url = `http://127.0.0.1:${bound}`;
  console.log(`@scout/agent v${PKG_VERSION} listening on ${url}`);
  console.log(`\n  Open Scout in your browser:  ${url}/app/\n`);
  console.log(
    "Serving the Scout UI from this loopback origin means the page is same-origin\n" +
      'with the API — no "Allow local network" prompt, no pairing token to paste.',
  );
  console.log("\nEndpoints: GET /healthz, POST /v0/interests, GET /v0/briefs?since=<iso>");
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "pair": {
        const force = rest.includes("--force") || rest.includes("--reset");
        await cmdPair(force);
        break;
      }
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
        console.error(`unknown command: ${cmd}. usage: scout-agent [pair|run|status]`);
        process.exit(2);
    }
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

main();
