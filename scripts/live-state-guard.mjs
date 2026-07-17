import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const action = process.argv[2];
const runId = process.env.PAPERCLIP_RUN_ID?.trim();
const stateDir = path.resolve(
  process.env.SCOUT_STATE_DIR ?? path.join(os.homedir(), ".config", "scout"),
);
const guardDir = path.resolve(
  process.env.SCOUT_LIVE_GUARD_DIR ??
    path.join(os.tmpdir(), "scout-live-state-guard"),
);

if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
  fail(
    "PAPERCLIP_RUN_ID must be set to a safe run identifier before touching the live origin",
  );
}
if (action !== "snapshot" && action !== "check") {
  fail("usage: pnpm --silent live-state-guard <snapshot|check>");
}

const snapshotFile = path.join(guardDir, `${runId}.json`);

try {
  if (action === "snapshot") {
    await fs.mkdir(guardDir, { recursive: true, mode: 0o700 });
    const manifest = await buildManifest();
    await fs.writeFile(
      snapshotFile,
      `${JSON.stringify({ version: 1, runId, stateDir, files: manifest })}\n`,
      { mode: 0o600 },
    );
  } else {
    const before = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
    if (before.version !== 1 || before.runId !== runId) {
      fail(`invalid snapshot for run ${runId}`);
    }
    if (before.stateDir !== stateDir) {
      fail(
        `snapshot for run ${runId} targets ${before.stateDir}, not ${stateDir}`,
      );
    }

    const after = await buildManifest();
    const changes = diffManifests(before.files, after);
    if (changes.length > 0) {
      console.error(
        `Scout live-state guard detected founder-visible state changes for run ${runId}:`,
      );
      for (const change of changes) console.error(change);
      process.exitCode = 1;
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function buildManifest() {
  const files = new Map();
  await hashFile("state.json", files);
  await walk("interests", files);
  await walk("chat", files);
  return Object.fromEntries(
    [...files].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function walk(relativeDir, files) {
  let entries;
  try {
    entries = await fs.readdir(path.join(stateDir, relativeDir), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) await walk(relativePath, files);
    else if (entry.isFile()) await hashFile(relativePath, files);
  }
}

async function hashFile(relativePath, files) {
  try {
    const contents = await fs.readFile(path.join(stateDir, relativePath));
    files.set(
      relativePath,
      crypto.createHash("sha256").update(contents).digest("hex"),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function diffManifests(before, after) {
  const paths = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  const changes = [];
  for (const relativePath of paths) {
    const oldHash = before[relativePath];
    const newHash = after[relativePath];
    if (oldHash === newHash) continue;
    if (oldHash === undefined)
      changes.push(`A ${relativePath} - -> ${newHash}`);
    else if (newHash === undefined)
      changes.push(`D ${relativePath} ${oldHash} -> -`);
    else changes.push(`M ${relativePath} ${oldHash} -> ${newHash}`);
  }
  return changes;
}

function fail(message) {
  console.error(`live-state-guard: ${message}`);
  process.exit(2);
}
