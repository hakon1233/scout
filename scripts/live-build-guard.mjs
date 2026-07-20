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
    if (value) args.push(value);
  }

  return args;
}

// A relative argument means nothing without the directory it is relative to.
// launchd reports one; the live job's is `/Users/<user>` while its script
// argument is absolute.
function launchAgentWorkingDirectory(output) {
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^working directory = (.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

// This used to be `if (path.isAbsolute(value)) args.push(value)` — a relative
// argument was silently DROPPED. A job of the shape
//   arguments = { <absolute node>, packages/agent/dist/cli.js }
//   working directory = <this checkout>
// then left one absolute argument standing, so the `args.length === 0` refusal
// never fired and the relative live path was invisible to the containment
// check. Every other unknown in this module refuses; this was the lone
// exception. Relative arguments are now placed against the working directory
// instead of discarded.
function placeLaunchAgentArgument(value, workingDirectory) {
  const describe = `${LAUNCH_AGENT_LABEL}'s argument`;
  if (path.isAbsolute(value)) return canonicalPath(value, describe);

  if (workingDirectory === null) {
    throw refuse(
      `${LAUNCH_AGENT_LABEL} has a relative argument (${value}) and no ` +
        "readable working directory, so it cannot be placed. It may resolve " +
        "inside this checkout.",
    );
  }

  const placed = path.resolve(
    canonicalPath(
      workingDirectory,
      `${LAUNCH_AGENT_LABEL}'s working directory`,
    ),
    value,
  );
  // Subcommands (`run`) place outside the checkout and are not paths at all,
  // so they must not refuse. Anything that places INSIDE the checkout is
  // treated as live whether or not it exists yet — the build overwrites this
  // tree either way. Canonicalise when it does exist, so a symlink under the
  // working directory cannot redirect a lexically-outside path back inside.
  try {
    return realpathSync.native(placed);
  } catch {
    return placed;
  }
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

  const workingDirectory = launchAgentWorkingDirectory(stdout);

  // placeLaunchAgentArgument throws on any argument we cannot account for, so
  // a live job we cannot fully read refuses here rather than falling through
  // to `return`.
  const liveTarget = args
    .map((arg) => placeLaunchAgentArgument(arg, workingDirectory))
    .find((placed) => isInside(placed, repo));
  if (!liveTarget) return;

  throw refuse(
    `${LAUNCH_AGENT_LABEL} uses a live-serving path inside this checkout:\n  ${liveTarget}\n` +
      "Building here could replace the founder's served backend or webroot. " +
      "Use a checkout that is not targeted by the live service; do not bypass this guard.",
  );
}

const scriptPath = fileURLToPath(import.meta.url);

// Node's ESM loader realpaths `import.meta.url`, but `path.resolve` does not
// follow symlinks. Invoked through any symlinked path component the two
// disagree, this block never runs, and the guard exits 0 SILENTLY while the
// `&& tsc` after it goes on to overwrite the live dist. That is not a corner
// case: npm/pnpm prepend node_modules/.bin, which is entirely symlinks.
// Canonicalise argv[1] so the comparison is between two real paths.
export function invokedAsScript(argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync.native(argv1) === scriptPath;
  } catch (error) {
    // We cannot tell whether we are the entrypoint. Staying silent here is
    // exactly the fail-open this canonicalisation exists to close.
    throw refuse(
      `cannot determine whether the guard is running as a script ` +
        `(${argv1}: ${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

try {
  if (invokedAsScript()) {
    assertSafeToBuild({
      repoRoot: path.resolve(path.dirname(scriptPath), ".."),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
