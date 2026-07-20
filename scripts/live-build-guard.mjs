// PER-300: a build must never rewrite the checkout used by the founder's
// running LaunchAgent. This is the emergency refusal seam until deployment
// moves launchd to immutable releases outside development workspaces.
//
// Every uncertainty here is a refusal. The guard only permits a build when it
// has positively established that the live service reads from somewhere else.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCH_AGENT_LABEL = "ing.scout.agent";

// Absolute, not PATH-resolved. npm/pnpm run scripts with the package's
// node_modules/.bin prepended to PATH, so a bare `launchctl` can be shadowed
// by a shim that prints the accepted "could not find service" text and turns
// the guard into a no-op.
export const LAUNCHCTL_BINARY = "/bin/launchctl";

function refuse(reason) {
  return new Error(`[live-build-guard] REFUSING TO BUILD: ${reason}`);
}

// A live path must resolve for real. The lexical fallback this used to have
// was a fail-open: if a launchd argument is a symlink whose leaf is missing or
// has been retargeted while the old process keeps serving, `path.resolve`
// reports a path OUTSIDE the checkout and the build is wrongly permitted.
// Ambiguity about what the live service reads is a refusal.
function canonicalPath(candidate, describe) {
  try {
    return realpathSync.native(candidate);
  } catch (error) {
    throw refuse(
      `cannot determine where ${describe} really points ` +
        `(${candidate}: ${error instanceof Error ? error.message : String(error)}). ` +
        "An unresolvable live path may still be served by the running process.",
    );
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function launchAgentArguments(output) {
  const args = [];
  let inArguments = false;

  for (const line of output.split("\n")) {
    const value = line.trim();
    if (!inArguments) {
      inArguments = value === "arguments = {";
      continue;
    }
    if (value === "}") break;
    if (path.isAbsolute(value)) args.push(value);
  }

  return args;
}

export function defaultInspectLaunchAgent({
  spawn = spawnSync,
  launchctlPath = LAUNCHCTL_BINARY,
} = {}) {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return spawn(launchctlPath, ["print", `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
    encoding: "utf8",
  });
}

export function assertSafeToBuild({
  repoRoot,
  platform = process.platform,
  inspectLaunchAgent = defaultInspectLaunchAgent,
}) {
  if (platform !== "darwin") return;

  const result = inspectLaunchAgent();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  // Could not run launchctl at all (missing binary, spawn failure). We learned
  // nothing about the live service, so we refuse.
  if (result.error) {
    throw refuse(
      `cannot verify whether this checkout is live ` +
        `(${LAUNCHCTL_BINARY}: ${result.error.message}).`,
    );
  }

  if (result.status !== 0) {
    if (stderr.includes(`Could not find service "${LAUNCH_AGENT_LABEL}"`))
      return;
    const detail =
      stderr.trim() || `${LAUNCHCTL_BINARY} exited ${result.status}`;
    throw refuse(`cannot verify whether this checkout is live (${detail}).`);
  }

  const repo = canonicalPath(repoRoot, "this checkout");
  const args = launchAgentArguments(stdout);
  if (args.length === 0) {
    throw refuse(
      `cannot verify whether this checkout is live; ` +
        `${LAUNCH_AGENT_LABEL} has no readable arguments.`,
    );
  }

  // canonicalPath throws on any unresolvable argument, so a live job we cannot
  // fully account for refuses here rather than falling through to `return`.
  const liveTarget = args.find((arg) =>
    isInside(canonicalPath(arg, `${LAUNCH_AGENT_LABEL}'s argument`), repo),
  );
  if (!liveTarget) return;

  throw refuse(
    `${LAUNCH_AGENT_LABEL} uses a live-serving path inside this checkout:\n  ${liveTarget}\n` +
      "Building here could replace the founder's served backend or webroot. " +
      "Use a checkout that is not targeted by the live service; do not bypass this guard.",
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repoRoot = path.resolve(path.dirname(scriptPath), "..");
  try {
    assertSafeToBuild({ repoRoot });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
