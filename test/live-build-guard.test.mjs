import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LAUNCHCTL_BINARY,
  assertSafeToBuild,
  defaultInspectLaunchAgent,
} from "../scripts/live-build-guard.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// argv[0] is a real, resolvable interpreter — the guard refuses on ANY live
// argument it cannot resolve, so the fixture must not depend on a host path
// like /usr/local/bin/node that may not exist.
function launchctlOutput(scriptPath, nodePath = process.execPath) {
  return `gui/501/ing.scout.agent = {
\tstate = running
\targuments = {
\t\t${nodePath}
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

// --- fail-closed paths (CTO review of 75d600f) ---------------------------

test("refuses when a live argument cannot be resolved to a real path", async (t) => {
  const { root, repoRoot, cli } = await fixture(t);
  // The running process still serves from inside the checkout, but the leaf it
  // was launched from is gone (or the symlink was retargeted). Resolving this
  // lexically lands OUTSIDE repoRoot and used to permit the build.
  const current = path.join(root, "current");
  await symlink(repoRoot, current);
  const linkedCli = path.join(current, path.relative(repoRoot, cli));
  await rm(cli);

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({
          status: 0,
          stdout: launchctlOutput(linkedCli),
          stderr: "",
        }),
      }),
    /REFUSING TO BUILD[\s\S]*cannot determine where/,
  );
});

test("refuses when this checkout cannot be resolved to a real path", async (t) => {
  const { root, cli } = await fixture(t);

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot: path.join(root, "does-not-exist"),
        platform: "darwin",
        inspectLaunchAgent: () => ({
          status: 0,
          stdout: launchctlOutput(cli),
          stderr: "",
        }),
      }),
    /REFUSING TO BUILD[\s\S]*cannot determine where this checkout/,
  );
});

test("refuses when launchctl itself cannot be executed", async (t) => {
  const { repoRoot } = await fixture(t);

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({
          error: new Error("spawnSync /bin/launchctl ENOENT"),
          status: null,
          stdout: "",
          stderr: "",
        }),
      }),
    /REFUSING TO BUILD[\s\S]*cannot verify whether this checkout is live/,
  );
});

test("inspects launchd through the absolute system binary, not PATH", () => {
  // A bare `launchctl` resolves through the PATH npm/pnpm hands to run-scripts,
  // where a shim printing "Could not find service" silently disarms the guard.
  assert.equal(LAUNCHCTL_BINARY, "/bin/launchctl");

  const calls = [];
  defaultInspectLaunchAgent({
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/bin/launchctl");
  assert.ok(path.isAbsolute(calls[0].file));
  assert.match(calls[0].args.join(" "), /^print gui\/\d+\/ing\.scout\.agent$/);
});

// --- mutation-seam wiring -------------------------------------------------
// The helper tests above all pass a stub inspector, so they stay green even if
// nothing calls the guard. These assert the two seams that actually rewrite
// founder-served bytes are wired to it.

test("the backend build runs the guard in the script body, not a bypassable lifecycle hook", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(REPO_ROOT, "packages", "agent", "package.json"),
      "utf8",
    ),
  );

  const build = manifest.scripts.build;
  assert.match(build, /live-build-guard\.mjs/);
  assert.ok(
    build.indexOf("live-build-guard.mjs") < build.indexOf("tsc"),
    `guard must run before tsc rewrites dist/: ${build}`,
  );
  // `npm --ignore-scripts run build` skips prebuild but still runs the body.
  assert.equal(
    manifest.scripts.prebuild,
    undefined,
    "the guard must not live in prebuild, where --ignore-scripts suppresses it",
  );
});

test("the webroot build runs the guard before it touches webroot/", async () => {
  const source = await readFile(
    path.join(REPO_ROOT, "scripts", "build-agent-webroot.mjs"),
    "utf8",
  );

  const guardCall = source.indexOf("assertSafeToBuild({");
  assert.ok(
    guardCall > 0,
    "build-agent-webroot.mjs must call assertSafeToBuild",
  );
  for (const mutation of ["execFileSync(", "fs.rm(", "fs.cp("]) {
    const at = source.indexOf(mutation);
    assert.ok(at > 0, `expected ${mutation} in build-agent-webroot.mjs`);
    assert.ok(
      guardCall < at,
      `guard must run before ${mutation} — it is the seam that replaces served assets`,
    );
  }
});

// --- end-to-end, on a machine where this checkout really is the live one ---
// These are the only tests that prove the wiring at the command level. They
// skip where launchd does not serve from this checkout (CI, any non-live
// clone); on the founder's machine today they are the real proof.

function thisCheckoutIsLive() {
  try {
    assertSafeToBuild({ repoRoot: REPO_ROOT });
    return false;
  } catch {
    return true;
  }
}

const liveSkip = thisCheckoutIsLive()
  ? false
  : "launchd does not serve from this checkout";

test(
  "npm --ignore-scripts run build refuses without rewriting dist/",
  { skip: liveSkip },
  async () => {
    const stamp = path.join(
      REPO_ROOT,
      "packages",
      "agent",
      "dist",
      "build-info.json",
    );
    const before = await stat(stamp).catch(() => null);

    const result = spawnSync("npm", ["--ignore-scripts", "run", "build"], {
      cwd: path.join(REPO_ROOT, "packages", "agent"),
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /REFUSING TO BUILD/,
      "the guard must refuse even with lifecycle scripts suppressed",
    );

    const after = await stat(stamp).catch(() => null);
    assert.equal(after?.mtimeMs ?? null, before?.mtimeMs ?? null);
  },
);

test(
  "the webroot build refuses without rewriting webroot/",
  { skip: liveSkip },
  async () => {
    const stamp = path.join(
      REPO_ROOT,
      "packages",
      "agent",
      "webroot",
      "scout-build.json",
    );
    const before = await stat(stamp).catch(() => null);

    const result = spawnSync(
      process.execPath,
      [path.join("scripts", "build-agent-webroot.mjs")],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /REFUSING TO BUILD/);

    const after = await stat(stamp).catch(() => null);
    assert.equal(after?.mtimeMs ?? null, before?.mtimeMs ?? null);
  },
);
