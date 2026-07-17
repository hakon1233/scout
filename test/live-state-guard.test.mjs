import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "live-state-guard.mjs");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scout-live-state-test-"));
  const stateDir = path.join(root, "state");
  const guardDir = path.join(root, "guard");
  await mkdir(path.join(stateDir, "interests"), { recursive: true });
  await mkdir(path.join(stateDir, "chat"), { recursive: true });
  await writeFile(
    path.join(stateDir, "state.json"),
    '{"last_brief":"original"}\n',
  );
  await writeFile(path.join(stateDir, "interests", "tech.md"), "# Tech\n");
  await writeFile(path.join(stateDir, "chat", "transcript.json"), "[]\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { stateDir, guardDir };
}

function run(action, { stateDir, guardDir }, runId) {
  return spawnSync(process.execPath, [SCRIPT, action], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPERCLIP_RUN_ID: runId,
      SCOUT_LIVE_GUARD_DIR: guardDir,
      SCOUT_STATE_DIR: stateDir,
    },
  });
}

test("stays quiet when founder-visible state is unchanged", async (t) => {
  const paths = await fixture(t);

  const snapshot = run("snapshot", paths, "test-run-clean");
  const check = run("check", paths, "test-run-clean");

  assert.equal(snapshot.status, 0, snapshot.stderr);
  assert.equal(snapshot.stdout, "");
  assert.equal(snapshot.stderr, "");
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout, "");
  assert.equal(check.stderr, "");
});

test("reports added, modified, and deleted state against the run", async (t) => {
  const paths = await fixture(t);
  const snapshot = run("snapshot", paths, "test-run-change");
  assert.equal(snapshot.status, 0, snapshot.stderr);

  await writeFile(
    path.join(paths.stateDir, "state.json"),
    '{"last_brief":"polluted"}\n',
  );
  await writeFile(path.join(paths.stateDir, "interests", "new.md"), "# New\n");
  await unlink(path.join(paths.stateDir, "chat", "transcript.json"));

  const check = run("check", paths, "test-run-change");

  assert.equal(check.status, 1);
  assert.equal(check.stdout, "");
  assert.match(check.stderr, /run test-run-change/);
  assert.match(check.stderr, /M state\.json/);
  assert.match(check.stderr, /A interests\/new\.md/);
  assert.match(check.stderr, /D chat\/transcript\.json/);
  assert.doesNotMatch(check.stderr, /polluted|# New/);
});
