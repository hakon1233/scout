// Reboot-durable companion via a macOS launchd LaunchAgent (PER-153).
//
// The nohup `scout-agent run` companion dies on logout/reboot, so the in-process
// scheduler (PER-151) silently stops firing until the founder re-runs it. This
// module installs a per-user LaunchAgent at
// `~/Library/LaunchAgents/ing.scout.agent.plist` with `RunAtLoad` + `KeepAlive`,
// so launchd starts `scout-agent run` at login/boot and respawns it if it exits.
//
// Once installed, GET /v0/schedule reports `reboot_durable:true` and the Settings
// UI (PER-152) drops its reboot caveat automatically (it gates on
// `!reboot_durable`). Uninstall removes the plist and the claim drops back.
//
// Design note: durability is detected by the canonical plist's presence. Both
// install and uninstall keep that file in lock-step with the launchctl job, so
// presence is an honest proxy for "launchd will bring this back after a reboot".
// This is macOS-only; install/uninstall no-op-error on other platforms.

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// launchd job label and the canonical per-user LaunchAgent path.
export const LAUNCH_AGENT_LABEL = "ing.scout.agent";

export function launchAgentsDir(home = os.homedir()): string {
  return path.join(home, "Library", "LaunchAgents");
}

export function plistPath(home = os.homedir()): string {
  // Test/override hook: pin the plist location so durability detection is
  // deterministic in hermetic tests (which don't override os.homedir()).
  const override = process.env.SCOUT_LAUNCH_AGENT_PLIST;
  if (override) return override;
  return path.join(launchAgentsDir(home), `${LAUNCH_AGENT_LABEL}.plist`);
}

export function logPath(home = os.homedir()): string {
  return path.join(home, "Library", "Logs", "scout-agent.log");
}

// True when the LaunchAgent plist is installed at the canonical path. This is
// the signal the server uses to report `reboot_durable`. Sync so the request
// path (scheduleView) can call it without going async.
export function isServiceInstalled(home = os.homedir()): boolean {
  return existsSync(plistPath(home));
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type PlistOptions = {
  // Absolute path to the node binary that runs the CLI.
  nodePath: string;
  // Absolute path to the compiled CLI entry (dist/cli.js).
  scriptPath: string;
  // Optional explicit port; omitted → companion default (47821).
  port?: number;
  // Where launchd writes stdout/stderr.
  logPath: string;
  // HOME the job runs under (so it reads the same ~/.config/scout/state.json).
  home: string;
  // PATH the job runs with. launchd does NOT inherit the login-shell PATH, so we
  // must set it explicitly or the spawned `claude` CLI won't be found.
  pathEnv: string;
};

// Build the LaunchAgent plist XML. Pure + side-effect free so it can be unit
// tested without touching the filesystem or launchctl.
export function buildLaunchAgentPlist(opts: PlistOptions): string {
  const args = [opts.nodePath, opts.scriptPath, "run"];
  if (opts.port) args.push("--port", String(opts.port));
  const programArgs = args
    .map((a) => `      <string>${xmlEscape(a)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(opts.home)}</string>
    <key>StandardOutPath</key>
    <string>${xmlEscape(opts.logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(opts.logPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${xmlEscape(opts.home)}</string>
      <key>PATH</key>
      <string>${xmlEscape(opts.pathEnv)}</string>
    </dict>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`;
}

// Best-effort: directory containing the `claude` CLI, so we can guarantee it's
// on the LaunchAgent PATH. Returns null if `claude` isn't resolvable.
async function claudeDir(): Promise<string | null> {
  const explicit = process.env.SCOUT_CLAUDE_BIN;
  if (explicit) return path.dirname(explicit);
  try {
    const { stdout } = await execFileP("/usr/bin/which", ["claude"]);
    const p = stdout.trim();
    return p ? path.dirname(p) : null;
  } catch {
    return null;
  }
}

// Compose the PATH the LaunchAgent runs with. Includes node's own dir, the
// resolved `claude` dir, and the usual GUI-session locations. De-duped, order
// preserved (earlier wins on lookup).
function composePath(nodeDir: string, claude: string | null): string {
  const parts = [
    nodeDir,
    claude,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((p): p is string => Boolean(p));
  return [...new Set(parts)].join(":");
}

async function launchctlDomainTarget(): Promise<string> {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `gui/${uid}`;
}

export type InstallResult = {
  plist: string;
  label: string;
  bootstrapped: boolean;
  note: string;
};

// Write the LaunchAgent plist and bootstrap it into the user's GUI domain so it
// starts now and on every login/boot. Idempotent: re-installing overwrites the
// plist and re-bootstraps (bootout first if already loaded).
export async function installService(opts?: {
  port?: number;
  home?: string;
  scriptPath?: string;
}): Promise<InstallResult> {
  if (process.platform !== "darwin") {
    throw new Error(
      "install-service is macOS-only (launchd). On other platforms run `scout-agent run` under your init system.",
    );
  }
  const home = opts?.home ?? os.homedir();
  const nodePath = process.execPath;
  // The compiled CLI entry. When invoked via the global `scout-agent` shim,
  // process.argv[1] resolves (through the symlink) to dist/cli.js.
  const scriptPath = opts?.scriptPath
    ? path.resolve(opts.scriptPath)
    : await fs.realpath(process.argv[1]);
  const lp = logPath(home);
  const pathEnv = composePath(path.dirname(nodePath), await claudeDir());

  const xml = buildLaunchAgentPlist({
    nodePath,
    scriptPath,
    port: opts?.port,
    logPath: lp,
    home,
    pathEnv,
  });

  await fs.mkdir(launchAgentsDir(home), { recursive: true });
  await fs.mkdir(path.dirname(lp), { recursive: true });
  const plist = plistPath(home);
  await fs.writeFile(plist, xml, { mode: 0o644 });

  // Bootstrap into the GUI domain. If a previous job is loaded, bootout first so
  // the new plist takes effect. Tolerate bootout failure (job may not be loaded).
  const domain = await launchctlDomainTarget();
  let bootstrapped = false;
  let note = "";
  try {
    await execFileP("launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`]).catch(
      () => undefined,
    );
    await execFileP("launchctl", ["bootstrap", domain, plist]);
    await execFileP("launchctl", [
      "kickstart",
      "-k",
      `${domain}/${LAUNCH_AGENT_LABEL}`,
    ]).catch(() => undefined);
    bootstrapped = true;
    note = "LaunchAgent bootstrapped — companion will start at login/boot.";
  } catch (err) {
    // Fall back to the legacy load API for older macOS.
    try {
      await execFileP("launchctl", ["load", "-w", plist]);
      bootstrapped = true;
      note = "LaunchAgent loaded (legacy launchctl load).";
    } catch {
      note =
        `Plist written but launchctl bootstrap failed (${String(err)}). ` +
        `Load it manually: launchctl bootstrap ${domain} ${plist}`;
    }
  }
  return { plist, label: LAUNCH_AGENT_LABEL, bootstrapped, note };
}

export type UninstallResult = {
  plist: string;
  removed: boolean;
  note: string;
};

// Bootout the launchd job and remove the plist. After this, isServiceInstalled()
// is false and /v0/schedule reports reboot_durable:false again.
export async function uninstallService(opts?: { home?: string }): Promise<UninstallResult> {
  if (process.platform !== "darwin") {
    throw new Error("uninstall-service is macOS-only (launchd).");
  }
  const home = opts?.home ?? os.homedir();
  const plist = plistPath(home);
  const domain = await launchctlDomainTarget();
  await execFileP("launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`]).catch(
    () => undefined,
  );
  // Legacy unload fallback (harmless if bootout already handled it).
  await execFileP("launchctl", ["unload", "-w", plist]).catch(() => undefined);
  let removed = false;
  try {
    await fs.rm(plist, { force: true });
    removed = !existsSync(plist);
  } catch {
    removed = false;
  }
  return {
    plist,
    removed,
    note: removed
      ? "LaunchAgent removed — companion is no longer reboot-durable."
      : `Could not remove ${plist}; delete it manually.`,
  };
}

export type ServiceStatus = {
  installed: boolean;
  plist: string;
  loaded: boolean | null; // null when launchctl print couldn't be queried
};

// Report whether the LaunchAgent is installed (plist present) and, best-effort,
// whether launchctl currently has the job loaded.
export async function serviceStatus(opts?: { home?: string }): Promise<ServiceStatus> {
  const home = opts?.home ?? os.homedir();
  const installed = isServiceInstalled(home);
  let loaded: boolean | null = null;
  if (process.platform === "darwin") {
    const domain = await launchctlDomainTarget();
    try {
      await execFileP("launchctl", ["print", `${domain}/${LAUNCH_AGENT_LABEL}`]);
      loaded = true;
    } catch {
      loaded = false;
    }
  }
  return { installed, plist: plistPath(home), loaded };
}
