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
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { atomicWriteFile } from "./persistence.js";

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

export function backupPlistPath(home = os.homedir()): string {
  return `${plistPath(home)}.previous`;
}

// The legacy (pre-release-system) plist, preserved once and never overwritten.
// It is the only record of the workspace path launchd used before the first
// migration: restartLaunchAgent can emit nothing but a `current`-pointing
// plist, so without this file the information needed to reverse the migration
// is destroyed by the migration itself.
export function preMigrationPlistPath(home = os.homedir()): string {
  return `${plistPath(home)}.pre-migration`;
}

// True when a VALID LaunchAgent plist is installed at the canonical path.
//
// This used to be a bare existsSync, which meant a truncated or half-written
// plist still reported reboot_durable:true while launchd would fail to
// bootstrap it at the next login. Existence is not validity. Sync so the
// request path (scheduleView) can call it without going async, so this is a
// structural check rather than a full parse: the label and the program
// arguments are what launchd needs to run the job at all.
export function isServiceInstalled(home = os.homedir()): boolean {
  const plist = plistPath(home);
  if (!existsSync(plist)) return false;
  try {
    return isPlistStructurallyValid(readFileSync(plist, "utf8"));
  } catch {
    return false;
  }
}

export function isPlistStructurallyValid(xml: string): boolean {
  if (!xml.includes("</plist>")) return false;
  if (
    !new RegExp(
      `<key>Label</key>\\s*<string>${LAUNCH_AGENT_LABEL}</string>`,
    ).test(xml)
  ) {
    return false;
  }
  const args = xml.match(
    /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  return Boolean(args) && /<string>[^<]+<\/string>/.test(args![1]);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  // Extra EnvironmentVariables to reproduce verbatim. The plist is regenerated
  // from scratch on every install, so anything not emitted here is SILENTLY
  // dropped. The live job carries SCOUT_SESSION_TIMEOUT_MS=900000; losing it
  // would drop research (research.ts) and per-chat-turn (chat.ts) timeouts back
  // to the ~4-minute default with no error anywhere.
  extraEnv?: Record<string, string>;
};

// Environment keys buildLaunchAgentPlist always emits itself.
export const MANAGED_ENV_KEYS = ["HOME", "PATH"] as const;

export type ExistingService = {
  plist: string;
  xml: string;
  programArguments: string[];
  environment: Record<string, string>;
  port: number | undefined;
};

function plistStrings(block: string): string[] {
  return [...block.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) =>
    xmlUnescape(m[1]),
  );
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Read the plist launchd is currently configured with, so a rewrite can
// reproduce what it holds instead of quietly replacing it.
export async function readExistingService(
  home = os.homedir(),
): Promise<ExistingService | null> {
  const plist = plistPath(home);
  const xml = await fs.readFile(plist, "utf8").catch(() => null);
  if (xml === null) return null;
  if (!isPlistStructurallyValid(xml)) {
    throw new Error(
      `The installed LaunchAgent plist at ${plist} is not structurally valid, ` +
        "so it cannot be safely reproduced. Inspect it by hand before migrating.",
    );
  }

  const argsBlock = xml.match(
    /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  const programArguments = argsBlock ? plistStrings(argsBlock[1]) : [];

  const envBlock = xml.match(
    /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/,
  );
  const environment: Record<string, string> = {};
  if (envBlock) {
    const pairs = [
      ...envBlock[1].matchAll(
        /<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g,
      ),
    ];
    for (const [, key, value] of pairs) {
      environment[xmlUnescape(key)] = xmlUnescape(value);
    }
  }

  // The live plist carries NO --port, while restartLaunchAgent always passes
  // one. Reproducing `undefined` rather than defaulting is what keeps a stray
  // SCOUT_AGENT_PORT from moving the founder off 47821.
  const portAt = programArguments.indexOf("--port");
  const parsedPort =
    portAt >= 0 ? Number.parseInt(programArguments[portAt + 1] ?? "", 10) : NaN;

  return {
    plist,
    xml,
    programArguments,
    environment,
    port: Number.isInteger(parsedPort) ? parsedPort : undefined,
  };
}

// Every env var the existing plist holds that the new one would not reproduce.
export function droppedEnvKeys(
  existing: Record<string, string>,
  extraEnv: Record<string, string> = {},
): string[] {
  return Object.keys(existing).filter(
    (key) =>
      !(MANAGED_ENV_KEYS as readonly string[]).includes(key) &&
      !(key in extraEnv),
  );
}

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
      <string>${xmlEscape(opts.pathEnv)}</string>${Object.entries(
        opts.extraEnv ?? {},
      )
        .filter(
          ([key]) => !(MANAGED_ENV_KEYS as readonly string[]).includes(key),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(
          ([key, value]) =>
            `\n      <key>${xmlEscape(key)}</key>\n      <string>${xmlEscape(value)}</string>`,
        )
        .join("")}
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

const RELEASE_SHA_DIR = /^[0-9a-f]{40}$/;

// A plist pinned inside releases/<sha>/ LOOKS migrated and permanently defeats
// the release design: every later deploy flips the `current` symlink while
// launchd keeps re-launching the frozen SHA, which is the two-answers problem
// PER-299 was opened to eliminate, made durable.
//
// This is exactly what the `realpath(process.argv[1])` default produces once a
// release is active, because realpath dereferences `current`. The check is on
// the literal path, not the resolved one, so the legitimate
// `<releaseRoot>/current/dist/cli.js` that restartLaunchAgent passes is
// accepted while the dereferenced form is refused. Adding a --script-path flag
// alone would not have fixed this — the unsafe value is the DEFAULT.
export function assertStableScriptPath(scriptPath: string): void {
  const parts = scriptPath.split(path.sep);
  const at = parts.findIndex((part) => RELEASE_SHA_DIR.test(part));
  if (at > 0 && parts[at - 1] === "releases") {
    throw new Error(
      `Refusing to pin the LaunchAgent to an immutable release directory:\n  ${scriptPath}\n` +
        "launchd must point at the stable `current` path so later deploys take " +
        "effect. Pass --script-path <releaseRoot>/current/dist/cli.js instead.",
    );
  }
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
export type BootstrapFn = (
  plist: string,
) => Promise<{ bootstrapped: boolean; note: string }>;

export async function installService(opts?: {
  port?: number;
  home?: string;
  scriptPath?: string;
  extraEnv?: Record<string, string>;
  // Seam so tests can drive the real plist-writing logic without letting
  // `launchctl bootout ing.scout.agent` reach the founder's running job.
  // Production callers leave it unset.
  bootstrap?: BootstrapFn;
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
  assertStableScriptPath(scriptPath);
  const lp = logPath(home);
  const pathEnv = composePath(path.dirname(nodePath), await claudeDir());

  const xml = buildLaunchAgentPlist({
    nodePath,
    scriptPath,
    port: opts?.port,
    logPath: lp,
    home,
    pathEnv,
    extraEnv: opts?.extraEnv,
  });

  await fs.mkdir(launchAgentsDir(home), { recursive: true });
  await fs.mkdir(path.dirname(lp), { recursive: true });
  const plist = plistPath(home);

  // Copy the prior plist BEFORE the first byte is written. This is the one
  // non-atomic step in a system whose entire selling point is atomicity, and
  // it runs at the moment of maximum risk on the founder's only instance.
  const priorXml = await fs.readFile(plist, "utf8").catch(() => null);
  if (priorXml !== null) {
    await atomicWriteFile(backupPlistPath(home), priorXml, 0o644);
  }
  await atomicWriteFile(plist, xml, 0o644);

  const { bootstrapped, note } = await (
    opts?.bootstrap ?? bootstrapLaunchAgent
  )(plist);
  return { plist, label: LAUNCH_AGENT_LABEL, bootstrapped, note };
}

// Bootstrap into the GUI domain. If a previous job is loaded, bootout first so
// the new plist takes effect. Tolerate bootout failure (job may not be loaded).
// Shared so the migration's rollback path reloads launchd exactly the way the
// forward path does.
async function bootstrapLaunchAgent(
  plist: string,
): Promise<{ bootstrapped: boolean; note: string }> {
  const domain = await launchctlDomainTarget();
  try {
    await execFileP("launchctl", [
      "bootout",
      `${domain}/${LAUNCH_AGENT_LABEL}`,
    ]).catch(() => undefined);
    await execFileP("launchctl", ["bootstrap", domain, plist]);
    await execFileP("launchctl", [
      "kickstart",
      "-k",
      `${domain}/${LAUNCH_AGENT_LABEL}`,
    ]).catch(() => undefined);
    return {
      bootstrapped: true,
      note: "LaunchAgent bootstrapped — companion will start at login/boot.",
    };
  } catch (err) {
    // Fall back to the legacy load API for older macOS.
    try {
      await execFileP("launchctl", ["load", "-w", plist]);
      return {
        bootstrapped: true,
        note: "LaunchAgent loaded (legacy launchctl load).",
      };
    } catch {
      return {
        bootstrapped: false,
        note:
          `Plist written but launchctl bootstrap failed (${String(err)}). ` +
          `Load it manually: launchctl bootstrap ${domain} ${plist}`,
      };
    }
  }
}

// Put an exact set of plist bytes back and reload launchd from them. The
// rollback counterpart to installService: installService can only ever emit a
// `current`-pointing plist, so it structurally cannot express "go back to the
// legacy workspace path". Only the preserved bytes can.
export async function restoreServicePlist(opts: {
  xml: string;
  home?: string;
  bootstrap?: BootstrapFn;
}): Promise<InstallResult> {
  const home = opts.home ?? os.homedir();
  const plist = plistPath(home);
  if (!isPlistStructurallyValid(opts.xml)) {
    throw new Error(
      "Refusing to restore a LaunchAgent plist that is not structurally valid.",
    );
  }
  await fs.mkdir(launchAgentsDir(home), { recursive: true });
  await atomicWriteFile(plist, opts.xml, 0o644);
  const { bootstrapped, note } = await (opts.bootstrap ?? bootstrapLaunchAgent)(
    plist,
  );
  return { plist, label: LAUNCH_AGENT_LABEL, bootstrapped, note };
}

export type UninstallResult = {
  plist: string;
  removed: boolean;
  note: string;
};

// Bootout the launchd job and remove the plist. After this, isServiceInstalled()
// is false and /v0/schedule reports reboot_durable:false again.
export async function uninstallService(opts?: {
  home?: string;
}): Promise<UninstallResult> {
  if (process.platform !== "darwin") {
    throw new Error("uninstall-service is macOS-only (launchd).");
  }
  const home = opts?.home ?? os.homedir();
  const plist = plistPath(home);
  const domain = await launchctlDomainTarget();
  await execFileP("launchctl", [
    "bootout",
    `${domain}/${LAUNCH_AGENT_LABEL}`,
  ]).catch(() => undefined);
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
export async function serviceStatus(opts?: {
  home?: string;
}): Promise<ServiceStatus> {
  const home = opts?.home ?? os.homedir();
  const installed = isServiceInstalled(home);
  let loaded: boolean | null = null;
  if (process.platform === "darwin") {
    const domain = await launchctlDomainTarget();
    try {
      await execFileP("launchctl", [
        "print",
        `${domain}/${LAUNCH_AGENT_LABEL}`,
      ]);
      loaded = true;
    } catch {
      loaded = false;
    }
  }
  return { installed, plist: plistPath(home), loaded };
}
