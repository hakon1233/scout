// PER-300: a build must never rewrite the checkout used by the founder's
// running LaunchAgent. This is the emergency refusal seam until deployment
// moves launchd to immutable releases outside development workspaces.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCH_AGENT_LABEL = "ing.scout.agent";

function canonicalPath(candidate) {
  try {
    return realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
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

function defaultInspectLaunchAgent() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return spawnSync("launchctl", ["print", `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
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
  if (result.status !== 0) {
    if (stderr.includes(`Could not find service "${LAUNCH_AGENT_LABEL}"`))
      return;
    const detail =
      result.error?.message ??
      stderr.trim() ??
      `launchctl exited ${result.status}`;
    throw new Error(
      `[live-build-guard] REFUSING TO BUILD: cannot verify whether this checkout is live (${detail}).`,
    );
  }

  const repo = canonicalPath(repoRoot);
  const args = launchAgentArguments(stdout);
  if (args.length === 0) {
    throw new Error(
      `[live-build-guard] REFUSING TO BUILD: cannot verify whether this checkout is live; ` +
        `${LAUNCH_AGENT_LABEL} has no readable arguments.`,
    );
  }

  const liveTarget = args.find((arg) => isInside(canonicalPath(arg), repo));
  if (!liveTarget) return;

  throw new Error(
    `[live-build-guard] REFUSING TO BUILD: ${LAUNCH_AGENT_LABEL} uses a live-serving path ` +
      `inside this checkout:\n  ${liveTarget}\n` +
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
