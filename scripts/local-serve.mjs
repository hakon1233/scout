#!/usr/bin/env node
// The founder's local Scout on the Mac (docs/ARCHITECTURE.md, "Local Scout on
// the Mac"): the hosted web app and its Worker relay, served from
// 127.0.0.1:47900 by the gateway (scripts/local-gateway.mts) as a launchd job,
// reached over the tailnet through `tailscale serve`.
//
//   pnpm local:serve            build (scripts/build-ideas.mjs), copy, (re)start
//   pnpm local:serve install    copy the current out/ and (re)start, no build
//   pnpm local:serve uninstall  stop the job and remove its plist
//
// The build points the app's Worker URL at LOCAL_ORIGIN, the gateway, which
// relays to the Worker. The site is copied to
// ~/Library/Application Support/Scout Local/, so `pnpm build` (which also
// writes out/) never changes what is served. The gateway runs from this
// checkout with its tsx, as the team runner's service does
// (packages/agent/src/team-runner-service.ts), because the relay starts
// `claude` through packages/agent/src/claude-runner.ts. The job is a per-user
// LaunchAgent: RunAtLoad + KeepAlive, logs in ~/Library/Logs/scout-local-web.log.
// The plist holds no secret: the gateway reads TEAM_RUNNER_TOKEN and
// SCOUT_WORKER_URL from ~/.config/scout-hosted/.env each time it starts.
//
// The build needs SUPABASE_ACCESS_TOKEN; unset, it is read from
// ~/.config/scout-hosted/.env.

import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOCAL_PORT } from "./local-server.mjs";

export const LABEL = "ing.scout.local-web";
// The Mac's address on the tailnet (`tailscale serve` in front of LOCAL_PORT).
export const LOCAL_ORIGIN =
  "https://openhakons-mac-mini.taildc1287.ts.net:47900";
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(SCRIPTS);

export function localPaths(home = os.homedir()) {
  const dir = path.join(home, "Library", "Application Support", "Scout Local");
  return {
    dir,
    site: path.join(dir, "site"),
    plist: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    log: path.join(home, "Library", "Logs", "scout-local-web.log"),
  };
}

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The LaunchAgent plist that runs the gateway from `repoDir` on `port`. Pure.
 * `pathEnv` must reach `claude`: launchd does not read the login shell's PATH.
 */
export function buildLocalWebPlist({
  nodePath,
  paths,
  repoDir,
  home,
  pathEnv,
  port = LOCAL_PORT,
}) {
  const args = [
    nodePath,
    path.join(repoDir, "node_modules", "tsx", "dist", "cli.mjs"),
    "--conditions=source",
    path.join(repoDir, "scripts", "local-gateway.mts"),
    paths.site,
    String(port),
  ]
    .map((a) => `      <string>${xmlEscape(a)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(repoDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${xmlEscape(home)}</string>
      <key>PATH</key>
      <string>${xmlEscape(pathEnv)}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(paths.log)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(paths.log)}</string>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`;
}

// Homebrew's versioned Cellar node disappears on `brew upgrade`; prefer the
// version-free opt link (as service.ts's stableNodePath does).
function stableNodePath(execPath = process.execPath) {
  const m = execPath.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/);
  const opt = m && `${m[1]}/opt/${m[2]}/bin/node`;
  return opt && existsSync(opt) ? opt : execPath;
}

// Every launchctl call goes through here and refuses under a test runner, so
// a test can never reach the real job.
function launchctl(args, { tolerate = false } = {}) {
  if (process.env.NODE_TEST_CONTEXT) {
    throw new Error(`Refusing to run launchctl ${args[0]} under a test runner`);
  }
  try {
    execFileSync("launchctl", args, { stdio: "ignore" });
  } catch (err) {
    if (!tolerate) throw err;
  }
}

const domain = () => `gui/${process.getuid?.() ?? 0}`;

// node's and claude's folders, then the usual ones.
function launchdPath(nodePath) {
  let claude = process.env.SCOUT_CLAUDE_BIN ?? "";
  if (!claude) {
    try {
      claude = execFileSync("/usr/bin/which", ["claude"]).toString().trim();
    } catch {
      claude = "";
    }
  }
  const dirs = [
    path.dirname(nodePath),
    claude && path.dirname(claude),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter(Boolean);
  return [...new Set(dirs)].join(":");
}

/** Copies out/ into place, writes the plist, (re)starts the gateway's job. */
export async function install({ outDir = path.join(REPO, "out") } = {}) {
  if (process.platform !== "darwin") throw new Error("macOS only (launchd)");
  if (!existsSync(path.join(outDir, "app", "index.html"))) {
    throw new Error(`${outDir} has no built app; run pnpm build:ideas`);
  }
  const paths = localPaths();
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.mkdir(path.dirname(paths.plist), { recursive: true });
  await fs.mkdir(path.dirname(paths.log), { recursive: true });

  // Swap the whole site in at once.
  const next = `${paths.site}.next`;
  const old = `${paths.site}.old`;
  await fs.rm(next, { recursive: true, force: true });
  await fs.rm(old, { recursive: true, force: true });
  await fs.cp(outDir, next, { recursive: true });
  if (existsSync(paths.site)) await fs.rename(paths.site, old);
  await fs.rename(next, paths.site);
  await fs.rm(old, { recursive: true, force: true });
  // The server copy an older install left; the gateway runs from the checkout.
  await fs.rm(path.join(paths.dir, "local-server.mjs"), { force: true });

  const nodePath = stableNodePath();
  await fs.writeFile(
    paths.plist,
    buildLocalWebPlist({
      nodePath,
      paths,
      repoDir: REPO,
      home: os.homedir(),
      pathEnv: launchdPath(nodePath),
    }),
  );
  launchctl(["bootout", `${domain()}/${LABEL}`], { tolerate: true });
  launchctl(["bootstrap", domain(), paths.plist]);
  launchctl(["kickstart", "-k", `${domain()}/${LABEL}`], { tolerate: true });
  console.log(`Serving on http://127.0.0.1:${LOCAL_PORT}/ (log ${paths.log})`);
}

/** Stops the job and removes its plist; the copied site stays. */
export async function uninstall() {
  const paths = localPaths();
  launchctl(["bootout", `${domain()}/${LABEL}`], { tolerate: true });
  await fs.rm(paths.plist, { force: true });
  console.log(`Stopped ${LABEL}; removed ${paths.plist}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const command = process.argv[2] ?? "build";
  if (command === "uninstall") {
    await uninstall();
  } else if (command === "install" || command === "build") {
    if (command === "build") {
      const envFile = path.join(os.homedir(), ".config/scout-hosted/.env");
      if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides
      const { buildIdeas } = await import("./build-ideas.mjs");
      await buildIdeas(process.env, { worker: LOCAL_ORIGIN });
    }
    await install();
  } else {
    throw new Error(`unknown command ${command}: build, install or uninstall`);
  }
}
