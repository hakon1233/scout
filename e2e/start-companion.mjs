// Playwright webServer entrypoint: build the packed @scout/agent artifact, pair
// it in a hermetic HOME, and run the loopback companion serving the Scout UI
// from its own origin (http://127.0.0.1:47821/app/). Everything here is offline
// and deterministic:
//
//   - The `claude` shell-out is redirected to e2e/fixtures/stub-claude.mjs via
//     SCOUT_CLAUDE_BIN, so synthesis is canned (no Anthropic/Exa key, no quota,
//     no network).
//   - HOME is overridden to a throwaway dir under e2e/.artifact/home so the
//     companion's state.json (os.homedir()/.config/scout/state.json — no env
//     override) never touches the developer's real config. Each run starts from
//     a clean paired state.
//
// Playwright waits on GET /healthz before starting tests (see playwright.config).

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildArtifact } from "./build-artifact.mjs";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const STUB_CLAUDE = path.join(E2E_DIR, "fixtures", "stub-claude.mjs");

const { cliEntry } = buildArtifact();

// Hermetic HOME so state.json lives in a throwaway location, reset every run.
const HOME = path.join(E2E_DIR, ".artifact", "home");
rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });

// research.ts: claudeBin = opts.claudeBin ?? process.env.SCOUT_CLAUDE_BIN ??
// "claude", then spawn(claudeBin, [fixed args]) with the prompt on stdin. Our
// stub is a `#!/usr/bin/env node` script marked executable, so pointing the env
// var straight at it lets spawn exec it directly (it ignores the fixed args and
// emits a canned brief).
const childEnv = {
  ...process.env,
  HOME,
  SCOUT_CLAUDE_BIN: STUB_CLAUDE,
};

function runCli(args, stdio) {
  execFileSync(process.execPath, [cliEntry, ...args], { env: childEnv, stdio });
}

// 1. Pair: mint + store a local token in the hermetic HOME. Swallow stdout so
//    the (ephemeral, throwaway-HOME) pairing token never prints to CI logs;
//    keep stderr for real failures.
runCli(["pair"], ["ignore", "ignore", "inherit"]);

// 2. Run the companion on the fixed loopback port. Keep this process alive by
//    inheriting the child; Playwright tears it down when the run ends.
const server = spawn(process.execPath, [cliEntry, "run", "--port", PORT], {
  env: childEnv,
  stdio: "inherit",
});

server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.kill(sig));
}
