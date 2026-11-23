// The Scout team runner as a launchd service on Håkon's Mac: `pnpm team:run
// --loop` from this checkout, started at login and restarted if it exits, so
// local accounts' runs and the Scout team's topics run within a minute of
// being due. Modelled on service.ts (the companion's LaunchAgent), with its
// own label and plist so the two never touch each other.
//
// `pnpm team:run install-service` / `uninstall-service`. The plist holds no
// secret: the runner reads TEAM_RUNNER_TOKEN and SCOUT_WORKER_URL from
// ~/.config/scout-hosted/.env each time it starts (scripts/team-run.mts).

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { atomicWriteFile } from "./persistence.js";
import { stableNodePath } from "./service.js";

const execFileP = promisify(execFile);

export const TEAM_RUNNER_LABEL = "ing.scout.team-runner";

export function teamRunnerPlistPath(home = os.homedir()): string {
  return path.join(
    home,
    "Library",
    "LaunchAgents",
    `${TEAM_RUNNER_LABEL}.plist`,
  );
}

export function teamRunnerLogPath(home = os.homedir()): string {
  return path.join(home, "Library", "Logs", "scout-team-runner.log");
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type TeamRunnerPlistOptions = {
  nodePath: string;
  // The Scout checkout the service runs from.
  repoDir: string;
  home: string;
  // launchd does not inherit the login shell's PATH: it must reach `claude`.
  pathEnv: string;
};

// Pure, so tests check it without the filesystem or launchctl.
export function buildTeamRunnerPlist(opts: TeamRunnerPlistOptions): string {
  const args = [
    opts.nodePath,
    path.join(opts.repoDir, "node_modules", "tsx", "dist", "cli.mjs"),
    "--conditions=source",
    path.join(opts.repoDir, "scripts", "team-run.mts"),
    "--loop",
  ];
  const log = xmlEscape(teamRunnerLogPath(opts.home));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${TEAM_RUNNER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((a) => `      <string>${xmlEscape(a)}</string>`).join("\n")}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ExitTimeOut</key>
    <integer>540</integer>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(opts.repoDir)}</string>
    <key>StandardOutPath</key>
    <string>${log}</string>
    <key>StandardErrorPath</key>
    <string>${log}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${xmlEscape(opts.home)}</string>
      <key>PATH</key>
      <string>${xmlEscape(opts.pathEnv)}</string>
      <key>SCOUT_TEAM_RUNNER</key>
      <string>on</string>
    </dict>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`;
}

export type Launchctl = (args: string[]) => Promise<unknown>;

// Refuses under a test runner, so a test that forgets its stub cannot reach
// the real launchd.
const realLaunchctl: Launchctl = async (args) => {
  if (process.env.NODE_TEST_CONTEXT)
    throw new Error("Refusing to run launchctl under a test runner");
  return execFileP("launchctl", args);
};

async function claudeDir(): Promise<string | null> {
  if (process.env.SCOUT_CLAUDE_BIN)
    return path.dirname(process.env.SCOUT_CLAUDE_BIN);
  try {
    const { stdout } = await execFileP("/usr/bin/which", ["claude"]);
    return stdout.trim() ? path.dirname(stdout.trim()) : null;
  } catch {
    return null;
  }
}

export type TeamServiceOptions = {
  repoDir: string;
  home?: string;
  launchctl?: Launchctl;
  // Tests pass these; the real ones come from the running node and `which`.
  nodePath?: string;
  pathEnv?: string;
  uid?: number;
};

const domain = (uid?: number) =>
  `gui/${uid ?? (typeof process.getuid === "function" ? process.getuid() : 0)}`;

// Writes the plist and (re)loads it. Returns the line to print.
export async function installTeamRunnerService(
  opts: TeamServiceOptions,
): Promise<string> {
  if (process.platform !== "darwin" && !opts.launchctl)
    throw new Error("The team runner service is macOS-only (launchd).");
  const home = opts.home ?? os.homedir();
  const launchctl = opts.launchctl ?? realLaunchctl;
  const nodePath = opts.nodePath ?? stableNodePath(process.execPath);
  const pathEnv =
    opts.pathEnv ??
    [
      ...new Set(
        [
          path.dirname(nodePath),
          await claudeDir(),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ].filter((p): p is string => Boolean(p)),
      ),
    ].join(":");
  const plist = teamRunnerPlistPath(home);
  await fs.mkdir(path.dirname(plist), { recursive: true });
  await fs.mkdir(path.dirname(teamRunnerLogPath(home)), { recursive: true });
  await atomicWriteFile(
    plist,
    buildTeamRunnerPlist({ nodePath, repoDir: opts.repoDir, home, pathEnv }),
    0o644,
  );
  const target = `${domain(opts.uid)}/${TEAM_RUNNER_LABEL}`;
  await launchctl(["bootout", target]).catch(() => undefined);
  await launchctl(["bootstrap", domain(opts.uid), plist]);
  return `Installed ${TEAM_RUNNER_LABEL}: it runs \`pnpm team:run --loop\` from ${opts.repoDir}. Log: ${teamRunnerLogPath(home)}`;
}

// Stops the service and removes its plist. Returns the line to print.
export async function uninstallTeamRunnerService(
  opts: Omit<TeamServiceOptions, "repoDir" | "nodePath" | "pathEnv">,
): Promise<string> {
  const home = opts.home ?? os.homedir();
  const launchctl = opts.launchctl ?? realLaunchctl;
  await launchctl([
    "bootout",
    `${domain(opts.uid)}/${TEAM_RUNNER_LABEL}`,
  ]).catch(() => undefined);
  await fs.rm(teamRunnerPlistPath(home), { force: true });
  return `Removed ${TEAM_RUNNER_LABEL}.`;
}
