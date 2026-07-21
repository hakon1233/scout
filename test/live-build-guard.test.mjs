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
  invokedAsScript,
  defaultInspectLaunchAgent,
} from "../scripts/live-build-guard.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// argv[0] is a real, resolvable interpreter — the guard refuses on ANY live
// argument it cannot resolve, so the fixture must not depend on a host path
// like /usr/local/bin/node that may not exist.
//
// The `working directory` line is not decoration: the real job reports one
// (`/Users/<user>`), and `run` is a relative argument that is only safe to
// ignore because it places outside the checkout. A fixture without it would
// not exercise the code path the live job actually takes.
function launchctlOutput(
  scriptPath,
  { nodePath = process.execPath, workingDirectory = os.homedir() } = {},
) {
  return `gui/501/ing.scout.agent = {
\tstate = running
\targuments = {
\t\t${nodePath}
\t\t${scriptPath}
\t\trun
\t}

\tworking directory = ${workingDirectory}
}`;
}

// Like launchctlOutput but takes the raw argument lines verbatim, so a test
// can plant a crafted argument (`}`, `working directory = …`) inside the block
// in the real ordering: the arguments block prints before the working
// directory line, each argument one tab deeper than the block's braces.
function launchctlOutputWith(argLines, { workingDirectory }) {
  const args = argLines.map((line) => `\t\t${line}`).join("\n");
  return `gui/501/ing.scout.agent = {
\tstate = running
\targuments = {
${args}
\t}

\tworking directory = ${workingDirectory}
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

// --- PER-303 blocker 8a: the CLI self-check must survive symlinks ----------

test("recognises itself as the entrypoint when invoked through a symlink", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scout-guard-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const real = path.join(REPO_ROOT, "scripts", "live-build-guard.mjs");
  const link = path.join(root, "live-build-guard.mjs");
  await symlink(real, link);

  // The bug: `path.resolve(link) !== realpath(link)`, so the old lexical
  // comparison went false and the guard exited 0 without ever running.
  assert.notEqual(path.resolve(link), real, "fixture must actually be a link");
  assert.equal(invokedAsScript(link), true);
  assert.equal(invokedAsScript(real), true);

  // A different real script is genuinely not the entrypoint.
  const other = path.join(root, "not-the-guard.mjs");
  await writeFile(other, "// fixture\n");
  assert.equal(invokedAsScript(other), false);

  // An argv[1] we cannot canonicalise leaves us unable to tell whether we are
  // the entrypoint. Silence there is the fail-open being closed, so it refuses.
  assert.throws(
    () => invokedAsScript(path.join(root, "missing.mjs")),
    /REFUSING TO BUILD[\s\S]*running as a script/,
  );
});

test(
  "invoked through a symlink the guard still refuses, and is not silent",
  { skip: liveSkip },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "scout-guard-symlink-"));
    t.after(() => rm(root, { recursive: true, force: true }));

    const link = path.join(root, "live-build-guard.mjs");
    await symlink(
      path.join(REPO_ROOT, "scripts", "live-build-guard.mjs"),
      link,
    );

    // Real symlink invocation, not an injected stub: this is the shape
    // npm/pnpm produce by prepending node_modules/.bin to PATH.
    const result = spawnSync(process.execPath, [link], { encoding: "utf8" });

    assert.equal(result.status, 1, "a symlink-invoked guard must not exit 0");
    assert.match(`${result.stdout}${result.stderr}`, /REFUSING TO BUILD/);
  },
);

// --- PER-303 blocker 8b: relative arguments are placed, never dropped ------

test("refuses when a relative LaunchAgent argument places inside this checkout", async (t) => {
  const { repoRoot, cli } = await fixture(t);

  // The exact shape the old `path.isAbsolute` filter made invisible: one
  // absolute argument survives, so the `args.length === 0` refusal never
  // fires, while the relative one resolves onto the live cli under the job's
  // working directory.
  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({
          status: 0,
          stdout: launchctlOutput(path.relative(repoRoot, cli), {
            workingDirectory: repoRoot,
          }),
          stderr: "",
        }),
      }),
    /REFUSING TO BUILD[\s\S]*live-serving path/,
  );
});

test("refuses a relative LaunchAgent argument it cannot place", async (t) => {
  const { repoRoot, cli } = await fixture(t);
  const stdout = launchctlOutput(cli).replace(/\n\tworking directory = .*/, "");

  assert.doesNotMatch(stdout, /working directory/);
  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({ status: 0, stdout, stderr: "" }),
      }),
    /REFUSING TO BUILD[\s\S]*relative argument \(run\)[\s\S]*working directory/,
  );
});

// --- PER-306: a crafted argument must not shadow the working directory or -----
// --- truncate the arguments block. Both hid a live path and permitted. --------

test("refuses when an argument literal shadows the job's working directory", async (t) => {
  const { repoRoot, cli } = await fixture(t);
  // A relative live path, placed against the honest working directory, lands
  // inside the checkout. The crafted argument's literal text is a
  // `working directory = …` line pointing outside; because the arguments block
  // prints first, a line-anywhere scan reads it as THE working directory and
  // re-places the live path under /tmp — outside — and permits.
  const stdout = launchctlOutputWith(
    [
      process.execPath, // absolute, resolves, outside the checkout
      "working directory = /tmp", // crafted: an argument value, not a real key
      path.relative(repoRoot, cli), // the live path, placed against the WD
      "run",
    ],
    { workingDirectory: repoRoot }, // the honest WD, printed after the args
  );

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({ status: 0, stdout, stderr: "" }),
      }),
    /REFUSING TO BUILD[\s\S]*live-serving path/,
  );
});

test("refuses when an argument literal '}' truncates the arguments block", async (t) => {
  const { root, repoRoot, cli } = await fixture(t);
  // The live path is absolute-inside-repo and sits AFTER the `}` argument, so
  // it is only reachable if the block is not truncated. The working directory
  // is outside the checkout, so neither `}` nor `run` (both relative) place
  // inside — the sole refusal trigger is the live cli seen past the `}`.
  const stdout = launchctlOutputWith(
    [
      process.execPath, // absolute, outside the checkout
      "}", // crafted: a bare `}` argument that used to end the block early
      cli, // absolute live path inside the checkout, AFTER the `}`
      "run",
    ],
    { workingDirectory: root },
  );

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({ status: 0, stdout, stderr: "" }),
      }),
    /REFUSING TO BUILD[\s\S]*live-serving path/,
  );
});

test("refuses when the job reports more than one working directory", async (t) => {
  const { repoRoot, cli } = await fixture(t);
  // Which directory relative live arguments are placed against is ambiguous,
  // and ambiguity is a refusal everywhere else in this module.
  const stdout = `gui/501/ing.scout.agent = {
\tstate = running
\targuments = {
\t\t${process.execPath}
\t\t${path.relative(repoRoot, cli)}
\t\trun
\t}

\tworking directory = ${repoRoot}
\tworking directory = /tmp
}`;

  assert.throws(
    () =>
      assertSafeToBuild({
        repoRoot,
        platform: "darwin",
        inspectLaunchAgent: () => ({ status: 0, stdout, stderr: "" }),
      }),
    /REFUSING TO BUILD[\s\S]*working directories[\s\S]*ambiguous/,
  );
});
