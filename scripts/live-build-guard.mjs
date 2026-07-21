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

function indentDepth(line) {
  let depth = 0;
  while (depth < line.length && line[depth] === "\t") depth += 1;
  return depth;
}

// `launchctl print` emits a tab-indented tree: the job dict's own keys sit one
// tab in, and each nested block (`arguments`, `environment`, ...) indents its
// contents one tab deeper and closes with a `}` dedented back to its opener.
// We read the arguments and the working directory in a SINGLE structured pass
// keyed on that indentation, so a value INSIDE `arguments = { … }` — which the
// plist author controls — can never be read as one of the job's top-level keys.
//
// Two fail-opens this closes (PER-306), both of which made a live path
// invisible to the containment check so the guard permitted instead of
// refusing:
//   - an argument whose literal text is `working directory = <outside>` was
//     picked up as the job's working directory. It sits in the arguments block,
//     which prints first, so a line-anywhere scan returned it before the real
//     `working directory` line and re-placed every relative live argument
//     outside the checkout.
//   - an argument whose literal text is `}` terminated the arguments block
//     early, hiding every argument after it — including the live path — while
//     the surviving earlier arguments kept `args.length === 0` from firing.
// Indentation depth decides both: argument values are read as opaque strings,
// the block ends only at the dedented `}`, and a `working directory` key is
// honoured only at the job's own top level. A relative argument means nothing
// without the directory it is relative to; the live job reports one
// (`/Users/<user>`) while its script argument is absolute.
function parseLaunchAgent(output) {
  const args = [];
  let workingDirectory = null;
  let workingDirectoryCount = 0;
  let argumentsDepth = null;

  for (const line of output.split("\n")) {
    const value = line.trim();
    if (value === "") continue;
    const depth = indentDepth(line);

    if (argumentsDepth !== null) {
      // Inside `arguments = { … }`: its values are indented deeper than the
      // opener. Only a line dedented back to the opener's depth closes the
      // block, so a `}` sitting at value depth is a literal argument, not the
      // terminator.
      if (depth > argumentsDepth) {
        args.push(value);
        continue;
      }
      argumentsDepth = null;
      // fall through: re-read this dedented line as a top-level key.
    }

    if (value === "arguments = {") {
      argumentsDepth = depth;
      continue;
    }

    const match = value.match(/^working directory = (.+)$/);
    if (match) {
      workingDirectoryCount += 1;
      workingDirectory = match[1].trim();
    }
  }

  // An ambiguous working directory is exactly the uncertainty this module
  // refuses on everywhere else: we cannot know which one the live service reads
  // relative live arguments against.
  if (workingDirectoryCount > 1) {
    throw refuse(
      `${LAUNCH_AGENT_LABEL} reports ${workingDirectoryCount} working ` +
        "directories; which one the live service reads from is ambiguous.",
    );
  }

  return { args, workingDirectory };
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
  const { args, workingDirectory } = parseLaunchAgent(stdout);
  if (args.length === 0) {
    throw refuse(
      `cannot verify whether this checkout is live; ` +
        `${LAUNCH_AGENT_LABEL} has no readable arguments.`,
    );
  }

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

// The entrypoint wiring, extracted so the call site itself is covered. Both
// collaborators are parameters ONLY so a unit test can drive all four branches
// — not the entrypoint (no check), the entrypoint (check), and either
// collaborator throwing (exit 1) — without a live LaunchAgent. This is not a
// production bypass: the sole caller is the top-level line below, which always
// passes the real two, and there is no env-var or PATH seam to swap them.
// Swapping the refusal seam is exactly the PATH-injection class PER-300 closed;
// re-opening it through a test hook would defeat the guard just as thoroughly.
export function runAsScript({ invokedAsScript, assertSafeToBuild }) {
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
}

runAsScript({ invokedAsScript, assertSafeToBuild });
