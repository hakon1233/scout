import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertSafeToBuild } from "../scripts/live-build-guard.mjs";

function launchctlOutput(scriptPath) {
  return `gui/501/ing.scout.agent = {
\tstate = running
\targuments = {
\t\t/usr/local/bin/node
\t\t${scriptPath}
\t\trun
\t}
}`;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scout-live-build-guard-"));
  const repoRoot = path.join(root, "workspace", "scout-repo");
  const cli = path.join(repoRoot, "packages", "agent", "dist", "cli.js");
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, "// fixture\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, repoRoot, cli };
}

test("refuses a build when the running LaunchAgent targets this checkout", async (t) => {
  const { repoRoot, cli } = await fixture(t);

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({
          status: 0,
          stdout: launchctlOutput(cli),
          stderr: "",
        }),
      }),
    /REFUSING TO BUILD[\s\S]*ing\.scout\.agent[\s\S]*live-serving path/,
  );
});

test("refuses when a stable-looking LaunchAgent path resolves into this checkout", async (t) => {
  const { root, repoRoot, cli } = await fixture(t);
  const current = path.join(root, "current");
  await symlink(repoRoot, current);
  const linkedCli = path.join(current, path.relative(repoRoot, cli));

  assert.throws(() =>
    assertSafeToBuild({
      repoRoot,
      platform: "darwin",
      inspectLaunchAgent: () => ({
        status: 0,
        stdout: launchctlOutput(linkedCli),
        stderr: "",
      }),
    }),
  );
});

test("allows builds when the running LaunchAgent target is outside this checkout", async (t) => {
  const { root, repoRoot } = await fixture(t);
  const releasedCli = path.join(root, "releases", "abc123", "dist", "cli.js");
  await mkdir(path.dirname(releasedCli), { recursive: true });
  await writeFile(releasedCli, "// released fixture\n");

  assert.doesNotThrow(() =>
    assertSafeToBuild({
      repoRoot,
      platform: "darwin",
      inspectLaunchAgent: () => ({
        status: 0,
        stdout: launchctlOutput(releasedCli),
        stderr: "",
      }),
    }),
  );
});

test("allows builds when Scout's LaunchAgent is not loaded", async (t) => {
  const { repoRoot } = await fixture(t);

  assert.doesNotThrow(() =>
    assertSafeToBuild({
      repoRoot,
      platform: "darwin",
      inspectLaunchAgent: () => ({
        status: 113,
        stdout: "",
        stderr:
          'Could not find service "ing.scout.agent" in domain for user gui: 501',
      }),
    }),
  );
});

test("fails closed when the LaunchAgent cannot be inspected", async (t) => {
  const { repoRoot } = await fixture(t);

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({
          status: 1,
          stdout: "",
          stderr: "permission denied",
        }),
      }),
    /cannot verify whether this checkout is live/,
  );
});

test("does not require launchctl away from macOS", async (t) => {
  const { repoRoot } = await fixture(t);

  assert.doesNotThrow(() =>
    assertSafeToBuild({
      repoRoot,
      platform: "linux",
      inspectLaunchAgent: () => {
        throw new Error("must not inspect launchd");
      },
    }),
  );
});
