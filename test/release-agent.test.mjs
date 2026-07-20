import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  activateRelease,
  assertCompanionIdle,
  assertDeployableCommit,
  assertExternalReleaseRoot,
  buildRelease,
  currentReleasePath,
  defaultReleaseRoot,
  restartLaunchAgent,
  migrateToReleases,
  stagePackedRelease,
  verifyRelease,
} from "../scripts/release-agent.mjs";

const execFileP = promisify(execFile);

// PER-310: the busy-run drain lives inside activateRelease/migrateToReleases,
// so EVERY caller must prove the companion is idle — there is no implicit
// bypass for tests either. Suites not about the drain inject an idle companion
// explicitly; `activityFetch` builds the other states.
function activityFetch(activityInFlight) {
  return async () =>
    new Response(JSON.stringify({ activity_in_flight: activityInFlight }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

const IDLE = { origin: "http://127.0.0.1:1", fetchImpl: activityFetch(false) };
const BUSY = { origin: "http://127.0.0.1:1", fetchImpl: activityFetch(true) };
// Activity state that cannot be read at all — the case SCOUT_ALLOW_UNKNOWN_ACTIVITY
// is about. Unreachable companion, not a companion reporting "no activity".
const UNKNOWN = {
  origin: "http://127.0.0.1:1",
  fetchImpl: async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:1");
  },
};

async function removeTree(root) {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  await fs.chmod(root, 0o755).catch(() => undefined);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) await removeTree(entryPath);
    else await fs.chmod(entryPath, 0o644).catch(() => undefined);
  }
  await fs.rm(root, { recursive: true, force: true });
}

async function tempReleaseRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scout-release-"));
  const releases = path.join(root, "releases");
  await fs.mkdir(releases, { recursive: true });
  return { root, releases };
}

async function addRelease(releases, sha, nextBuildId = `ui-${sha[0]}`) {
  const dir = path.join(releases, sha);
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.mkdir(path.join(dir, "webroot"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "release.json"),
    `${JSON.stringify({ sha, next_build_id: nextBuildId })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "dist", "build-info.json"),
    `${JSON.stringify({ git_sha: sha, next_build_id: nextBuildId })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "webroot", "scout-build.json"),
    `${JSON.stringify({ next_build_id: nextBuildId })}\n`,
  );
  return dir;
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function addFakeCompanion(
  releases,
  sha,
  nextBuildId,
  { fail = false, servedBuildId = nextBuildId, versionSha = sha } = {},
) {
  const dir = await addRelease(releases, sha, nextBuildId);
  // The manifest side (/v0/version) and the served-webroot side
  // (/scout-build.json) are stored as SEPARATE fields. Serving both from one
  // field made verifyRelease's cross-check unfalsifiable — the check that
  // catches a stale webroot had no real coverage at all.
  await fs.writeFile(
    path.join(dir, "release.json"),
    `${JSON.stringify({
      sha,
      next_build_id: nextBuildId,
      served_build_id: servedBuildId,
      version_sha: versionSha,
      fail,
    })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "server.mjs"),
    `import http from "node:http";
import { promises as fs } from "node:fs";
const release = JSON.parse(await fs.readFile(new URL("./release.json", import.meta.url), "utf8"));
if (release.fail) process.exit(1);
await fs.writeFile(process.argv[3], release.sha + "\\n");
http.createServer((req, res) => {
  res.setHeader("content-type", req.url === "/v0/version" || req.url === "/scout-build.json" ? "application/json" : "text/html");
  if (req.url === "/v0/version") res.end(JSON.stringify({ ok: true, git_sha: release.version_sha, next_build_id: release.next_build_id, activity_in_flight: false }));
  else if (req.url === "/app/") res.end('<link href="/_next/static/media/font.woff2"><script src="/_next/static/chunks/app.js"></script>');
  else if (req.url === "/scout-build.json") res.end(JSON.stringify({ next_build_id: release.served_build_id }));
  else { res.statusCode = 404; res.end("missing"); }
}).listen(Number(process.argv[2]), "127.0.0.1");
`,
  );
  return dir;
}

test("activateRelease atomically advances current to an immutable SHA directory", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addRelease(releases, "a".repeat(40));
  const releaseB = await addRelease(releases, "b".repeat(40));
  await fs.symlink(releaseA, path.join(root, "current"));

  const restarted = [];
  const result = await activateRelease({
    ...IDLE,
    releaseRoot: root,
    sha: "b".repeat(40),
    restart: async (release) => restarted.push(release),
    verify: async () => undefined,
  });

  assert.equal(await currentReleasePath(root), await fs.realpath(releaseB));
  assert.deepEqual(restarted, [releaseB]);
  assert.deepEqual(result, {
    activated: "b".repeat(40),
    previous: "a".repeat(40),
    rolledBack: false,
  });
});

test("activateRelease restores and restarts the previous release when verification fails", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addRelease(releases, "a".repeat(40));
  const releaseB = await addRelease(releases, "b".repeat(40));
  await fs.symlink(releaseA, path.join(root, "current"));

  const restarted = [];
  await assert.rejects(
    activateRelease({
      ...IDLE,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async (release) => restarted.push(release),
      verify: async ({ sha }) => {
        if (sha === "b".repeat(40)) throw new Error("wrong provenance");
      },
    }),
    /rolled back.*wrong provenance/i,
  );

  assert.equal(await currentReleasePath(root), await fs.realpath(releaseA));
  assert.deepEqual(restarted, [releaseB, await fs.realpath(releaseA)]);
});

test("activateRelease reports candidate and rollback failures together", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addRelease(releases, "a".repeat(40));
  await addRelease(releases, "b".repeat(40));
  await fs.symlink(releaseA, path.join(root, "current"));

  await assert.rejects(
    activateRelease({
      ...IDLE,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async (release) => {
        if (release.endsWith("a".repeat(40))) {
          throw new Error("rollback restart failed");
        }
      },
      verify: async ({ sha }) => {
        if (sha === "b".repeat(40)) throw new Error("candidate was wrong");
      },
    }),
    /candidate was wrong.*rollback also failed.*rollback restart failed/i,
  );
  assert.equal(await currentReleasePath(root), await fs.realpath(releaseA));
});

test("activateRelease refuses a concurrent activation lock", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  await addRelease(releases, "b".repeat(40));
  await fs.writeFile(path.join(root, "activation.lock"), `${process.pid}\n`);

  await assert.rejects(
    activateRelease({
      ...IDLE,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async () => undefined,
      verify: async () => undefined,
    }),
    /another activation.*pid/i,
  );
});

test("assertDeployableCommit rejects dirty and unpushed source", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-release-git-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const remote = path.join(tmp, "remote.git");
  const repo = path.join(tmp, "repo");
  await execFileP("git", ["init", "--bare", remote]);
  await execFileP("git", ["init", "-b", "main", repo]);
  await execFileP("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
  });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: repo });
  await fs.writeFile(path.join(repo, "file.txt"), "one\n");
  await execFileP("git", ["add", "file.txt"], { cwd: repo });
  await execFileP("git", ["commit", "-m", "one"], { cwd: repo });
  await execFileP("git", ["remote", "add", "origin", remote], { cwd: repo });
  await execFileP("git", ["push", "-u", "origin", "main"], { cwd: repo });

  const clean = await assertDeployableCommit(repo);
  assert.match(clean.sha, /^[0-9a-f]{40}$/);

  await fs.writeFile(path.join(repo, "file.txt"), "dirty\n");
  await assert.rejects(assertDeployableCommit(repo), /dirty/i);
  await execFileP("git", ["restore", "file.txt"], { cwd: repo });

  await fs.writeFile(path.join(repo, "file.txt"), "two\n");
  await execFileP("git", ["add", "file.txt"], { cwd: repo });
  await execFileP("git", ["commit", "-m", "two"], { cwd: repo });
  await assert.rejects(
    assertDeployableCommit(repo),
    /not pushed|origin\/main/i,
  );
});

test("release roots default to macOS Application Support and refuse workspace paths", async (t) => {
  assert.equal(
    defaultReleaseRoot("/Users/scout"),
    "/Users/scout/Library/Application Support/Scout/agent",
  );
  assert.throws(
    () => assertExternalReleaseRoot("/work/scout", "/work/scout/releases"),
    /outside/i,
  );
  assert.throws(
    () =>
      assertExternalReleaseRoot(
        "/work/scout",
        "/Users/scout/.paperclip/instances/default/workspaces/other/releases",
      ),
    /workspace/i,
  );
  assert.doesNotThrow(() =>
    assertExternalReleaseRoot(
      "/work/scout",
      "/Users/scout/Library/Application Support/Scout/agent",
    ),
  );

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-release-root-"));
  const repo = path.join(tmp, "repo");
  const alias = path.join(tmp, "outside-looking-alias");
  await fs.mkdir(repo);
  await fs.symlink(repo, alias);
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  assert.throws(
    () => assertExternalReleaseRoot(repo, path.join(alias, "releases")),
    /outside/i,
  );
});

test("assertCompanionIdle is fail-closed and refuses any known activity", async () => {
  const response = (body) => async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    assertCompanionIdle(
      "http://127.0.0.1:1",
      response({ activity_in_flight: true }),
    ),
    /activity is in flight/i,
  );
  await assert.doesNotReject(
    assertCompanionIdle(
      "http://127.0.0.1:1",
      response({ activity_in_flight: false }),
    ),
  );
  await assert.rejects(
    assertCompanionIdle("http://127.0.0.1:1", response({})),
    /cannot prove.*idle/i,
  );
});

test("activateRelease refuses the separately approved first migration", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  await addRelease(releases, "b".repeat(40));
  const restarted = [];

  await assert.rejects(
    activateRelease({
      ...IDLE,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async (release) => restarted.push(release),
      verify: async () => undefined,
    }),
    /first migration.*separate approval/i,
  );
  assert.deepEqual(restarted, []);
  await assert.rejects(fs.lstat(path.join(root, "current")), /ENOENT/);
});

// A packed artifact whose provenance fields are set by the FIXTURE, never by
// the code under test. stagePackedRelease's job is to observe these, so a test
// that let it author them would prove nothing.
async function packedAgentFixture(
  t,
  { gitSha, gitShaShort, uiBuildId = "ui-c" },
) {
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), "scout-packed-agent-"),
  );
  const packageDir = path.join(fixture, "package");
  await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
  await fs.mkdir(path.join(packageDir, "webroot", "app"), { recursive: true });
  await fs.writeFile(
    path.join(packageDir, "dist", "build-info.json"),
    `${JSON.stringify({
      git_sha: gitSha,
      git_sha_short: gitShaShort,
      next_build_id: uiBuildId,
      built_at: "2026-07-20T00:00:00.000Z",
    })}\n`,
  );
  await fs.writeFile(
    path.join(packageDir, "webroot", "app", "index.html"),
    '<link href="/_next/static/media/font.woff2"><script src="/_next/static/chunks/app.js"></script>\n',
  );
  await fs.writeFile(
    path.join(packageDir, "webroot", "scout-build.json"),
    `${JSON.stringify({ next_build_id: uiBuildId })}\n`,
  );
  await fs.writeFile(
    path.join(packageDir, "package.json"),
    '{"name":"@scout/agent"}\n',
  );
  const tarball = path.join(fixture, "scout-agent.tgz");
  await execFileP("tar", ["-czf", tarball, "package"], { cwd: fixture });
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  return tarball;
}

test("stagePackedRelease observes the artifact's own SHA and freezes the directory", async (t) => {
  const { root } = await tempReleaseRoot();
  const sha = "c".repeat(40);
  const tarball = await packedAgentFixture(t, {
    gitSha: sha,
    gitShaShort: "ccccccc",
  });
  t.after(() => removeTree(root));

  const releasePath = await stagePackedRelease({
    tarball,
    releaseRoot: root,
    sha,
    shortSha: "ccccccc",
  });

  assert.equal(releasePath, path.join(root, "releases", sha));

  // The packed build-info must come through byte-identical. Rewriting it is
  // what made the live SHA an assertion instead of an observation (PER-299).
  const buildInfo = JSON.parse(
    await fs.readFile(
      path.join(releasePath, "dist", "build-info.json"),
      "utf8",
    ),
  );
  assert.deepEqual(buildInfo, {
    git_sha: sha,
    git_sha_short: "ccccccc",
    next_build_id: "ui-c",
    built_at: "2026-07-20T00:00:00.000Z",
  });
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(releasePath, "release.json"), "utf8"),
    ),
    {
      sha,
      git_sha_short: "ccccccc",
      next_build_id: "ui-c",
      built_at: "2026-07-20T00:00:00.000Z",
    },
  );

  const fileMode = (await fs.stat(path.join(releasePath, "release.json"))).mode;
  const dirMode = (await fs.stat(releasePath)).mode;
  assert.equal(fileMode & 0o222, 0, "release files are read-only");
  assert.equal(dirMode & 0o222, 0, "release directories are read-only");

  await fs.chmod(releasePath, 0o755);
  await fs.chmod(path.join(releasePath, "release.json"), 0o644);
  assert.equal(
    await stagePackedRelease({
      tarball,
      releaseRoot: root,
      sha,
      shortSha: "ccccccc",
    }),
    releasePath,
  );
  assert.equal((await fs.stat(releasePath)).mode & 0o222, 0);
  assert.equal(
    (await fs.stat(path.join(releasePath, "release.json"))).mode & 0o222,
    0,
  );
});

// The three signals that would have caught the laundering. Each must refuse,
// and each must refuse for its OWN stated reason — a single equality check
// rejects all three but tells the operator nothing about which one fired.

test("stagePackedRelease refuses an artifact built from a dirty worktree", async (t) => {
  const { root } = await tempReleaseRoot();
  const sha = "c".repeat(40);
  const tarball = await packedAgentFixture(t, {
    gitSha: `${sha}-dirty`,
    gitShaShort: "ccccccc-dirty",
  });
  t.after(() => removeTree(root));

  await assert.rejects(
    stagePackedRelease({
      tarball,
      releaseRoot: root,
      sha,
      shortSha: "ccccccc",
    }),
    /dirty worktree/,
  );
  await assert.rejects(
    fs.lstat(path.join(root, "releases", sha)),
    /ENOENT/,
    "a refused release must leave nothing staged",
  );
});

test("stagePackedRelease refuses an artifact with no recorded SHA", async (t) => {
  const { root } = await tempReleaseRoot();
  const sha = "c".repeat(40);
  // write-build-info.mjs returns null whenever git could not be read.
  const tarball = await packedAgentFixture(t, {
    gitSha: null,
    gitShaShort: null,
  });
  t.after(() => removeTree(root));

  await assert.rejects(
    stagePackedRelease({
      tarball,
      releaseRoot: root,
      sha,
      shortSha: "ccccccc",
    }),
    /records no git_sha/,
  );
});

test("stagePackedRelease refuses an artifact built from a different commit", async (t) => {
  const { root } = await tempReleaseRoot();
  const sha = "c".repeat(40);
  const tarball = await packedAgentFixture(t, {
    gitSha: "d".repeat(40),
    gitShaShort: "ddddddd",
  });
  t.after(() => removeTree(root));

  await assert.rejects(
    stagePackedRelease({
      tarball,
      releaseRoot: root,
      sha,
      shortSha: "ccccccc",
    }),
    /reports git_sha d{40}, expected c{40}/,
  );
});

test("stagePackedRelease rejects an existing SHA symlink", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "scout-release-escape-"),
  );
  const sha = "d".repeat(40);
  t.after(async () => {
    await removeTree(root);
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.symlink(outside, path.join(releases, sha));

  await assert.rejects(
    stagePackedRelease({
      tarball: path.join(outside, "unused.tgz"),
      releaseRoot: root,
      sha,
      shortSha: "ddddddd",
    }),
    /real staged directory/i,
  );
});

test("buildRelease packs a detached clean commit into its SHA-addressed directory", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-build-release-"));
  const remote = path.join(tmp, "remote.git");
  const repo = path.join(tmp, "repo");
  const releaseRoot = path.join(tmp, "installed");
  await execFileP("git", ["init", "--bare", remote]);
  await execFileP("git", ["init", "-b", "main", repo]);
  await execFileP("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
  });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: repo });
  await fs.writeFile(path.join(repo, "source.txt"), "release source\n");
  await execFileP("git", ["add", "source.txt"], { cwd: repo });
  await execFileP("git", ["commit", "-m", "release"], { cwd: repo });
  await execFileP("git", ["remote", "add", "origin", remote], { cwd: repo });
  await execFileP("git", ["push", "-u", "origin", "main"], { cwd: repo });
  const sha = (
    await execFileP("git", ["rev-parse", "HEAD"], { cwd: repo })
  ).stdout.trim();
  t.after(() => removeTree(tmp));

  const releasePath = await buildRelease({
    repoRoot: repo,
    releaseRoot,
    pack: async (worktree) => {
      const worktreeSha = (
        await execFileP("git", ["rev-parse", "HEAD"], { cwd: worktree })
      ).stdout.trim();
      assert.equal(worktreeSha, sha);
      const worktreeShortSha = (
        await execFileP("git", ["rev-parse", "--short", "HEAD"], {
          cwd: worktree,
        })
      ).stdout.trim();
      const packageDir = path.join(worktree, "package");
      await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
      await fs.mkdir(path.join(packageDir, "webroot", "app"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(packageDir, "dist", "build-info.json"),
        // Derived from the worktree the build actually ran in, the way
        // write-build-info.mjs derives it. This stub previously emitted no
        // git_sha at all and the assertion below still passed, because
        // stagePackedRelease wrote the expected SHA in itself.
        `${JSON.stringify({
          git_sha: worktreeSha,
          git_sha_short: worktreeShortSha,
          next_build_id: "ui-release",
          built_at: "now",
        })}\n`,
      );
      await fs.writeFile(
        path.join(packageDir, "webroot", "app", "index.html"),
        '<link href="/_next/static/media/font.woff2"><script src="/_next/static/chunks/app.js"></script>\n',
      );
      await fs.writeFile(
        path.join(packageDir, "webroot", "scout-build.json"),
        `${JSON.stringify({ next_build_id: "ui-release" })}\n`,
      );
      const tarball = path.join(worktree, "agent.tgz");
      await execFileP("tar", ["-czf", tarball, "package"], { cwd: worktree });
      return tarball;
    },
  });

  assert.equal(releasePath, path.join(releaseRoot, "releases", sha));
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(releasePath, "release.json"), "utf8"),
    ).sha,
    sha,
  );
});

test("restartLaunchAgent installs launchd against the stable current CLI path", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "scout-restart-release-"),
  );
  const currentDist = path.join(root, "current", "dist");
  const callFile = path.join(root, "install-call.json");
  await fs.mkdir(currentDist, { recursive: true });
  await fs.writeFile(path.join(currentDist, "cli.js"), "// fixture\n");
  await fs.writeFile(
    path.join(currentDist, "service.js"),
    `import { promises as fs } from "node:fs";
export async function installService(opts) {
  await fs.writeFile(${JSON.stringify(callFile)}, JSON.stringify(opts));
  return { bootstrapped: true };
}
`,
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await restartLaunchAgent({
    releaseRoot: root,
    home: "/tmp/scout-home",
    port: 47899,
  });

  assert.deepEqual(JSON.parse(await fs.readFile(callFile, "utf8")), {
    home: "/tmp/scout-home",
    port: 47899,
    scriptPath: path.join(root, "current", "dist", "cli.js"),
  });
});

test("hermetic stable-current spike activates A to B and rolls a failed release back to B", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const shaFail = "f".repeat(40);
  const releaseA = await addFakeCompanion(releases, shaA, "ui-a");
  const releaseB = await addFakeCompanion(releases, shaB, "ui-b");
  await addFakeCompanion(releases, shaFail, "ui-fail", { fail: true });
  await fs.symlink(releaseA, path.join(root, "current"));
  const port = await freePort();
  const stateFile = path.join(root, "state", "started-sha");
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  let child = null;

  async function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await once(child, "exit");
  }

  async function restart() {
    await stop();
    child = spawn(
      process.execPath,
      [path.join(root, "current", "server.mjs"), String(port), stateFile],
      { stdio: "ignore" },
    );
  }

  async function verify({ sha }) {
    await verifyRelease({
      origin: `http://127.0.0.1:${port}`,
      sha,
      attempts: 50,
      delayMs: 20,
    });
  }

  t.after(async () => {
    await stop();
    await removeTree(root);
  });

  await restart();
  await verify({ sha: shaA });
  await activateRelease({
    ...IDLE,
    releaseRoot: root,
    sha: shaB,
    restart,
    verify,
  });
  assert.equal((await fs.readFile(stateFile, "utf8")).trim(), shaB);
  assert.equal(await currentReleasePath(root), await fs.realpath(releaseB));

  await assert.rejects(
    activateRelease({
      ...IDLE,
      releaseRoot: root,
      sha: shaFail,
      restart,
      verify,
    }),
    /rolled back/i,
  );
  assert.equal((await fs.readFile(stateFile, "utf8")).trim(), shaB);
  assert.equal(await currentReleasePath(root), await fs.realpath(releaseB));
});

test("verifyRelease bounds a hung readiness request", async () => {
  const started = Date.now();
  await assert.rejects(
    verifyRelease({
      origin: "http://127.0.0.1:1",
      sha: "a".repeat(40),
      attempts: 1,
      requestTimeoutMs: 25,
      deadlineMs: 100,
      fetchImpl: async () => await new Promise(() => undefined),
    }),
    /timed out/i,
  );
  assert.ok(Date.now() - started < 500, "readiness timeout is bounded");
});

test("readiness and drain time out when headers arrive but the body stalls", async () => {
  const stalledResponse = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true'));
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await assert.rejects(
    verifyRelease({
      origin: "http://127.0.0.1:1",
      sha: "a".repeat(40),
      attempts: 1,
      requestTimeoutMs: 25,
      deadlineMs: 100,
      fetchImpl: stalledResponse,
    }),
    /timed out/i,
  );
  await assert.rejects(
    assertCompanionIdle("http://127.0.0.1:1", stalledResponse, {
      requestTimeoutMs: 25,
    }),
    /timed out/i,
  );
});

// --- PER-303 blockers 5/6: the first migration, legacy -> current ---------
//
// These drive the REAL installService compiled from packages/agent/src, not a
// hand-rolled in-test plist. A hand-rolled one proves nothing about the code
// that will actually run on the founder's machine.
//
// SAFETY: launchctl is never invoked — a `bootstrap` stub is injected, and
// SCOUT_LAUNCH_AGENT_PLIST pins the plist under a temp dir. Compiling to a temp
// outDir also means packages/agent/dist (which the live service runs from) is
// never rewritten.

const AGENT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "agent",
);

async function compileServiceInto(distDir) {
  await fs.mkdir(distDir, { recursive: true });
  await execFileP(
    "pnpm",
    [
      "exec",
      "tsc",
      "src/service.ts",
      "--outDir",
      distDir,
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--target",
      "es2022",
      "--skipLibCheck",
    ],
    { cwd: AGENT_DIR },
  );
}

function legacyPlistXml({ scriptPath, home }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ing.scout.agent</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/node</string>
      <string>${scriptPath}</string>
      <string>run</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${home}</string>
      <key>PATH</key>
      <string>/usr/bin:/bin</string>
      <key>SCOUT_SESSION_TIMEOUT_MS</key>
      <string>900000</string>
    </dict>
  </dict>
</plist>
`;
}

async function migrationFixture(t) {
  const { root, releases } = await tempReleaseRoot();
  const sha = "e".repeat(40);
  const release = await addRelease(releases, sha);
  await compileServiceInto(path.join(release, "dist"));

  const home = await fs.mkdtemp(path.join(os.tmpdir(), "scout-migrate-home-"));
  const plist = path.join(home, "ing.scout.agent.plist");
  const legacyScript = path.join(home, "workspace", "dist", "cli.js");
  const legacy = legacyPlistXml({ scriptPath: legacyScript, home });
  await fs.writeFile(plist, legacy);

  const previousOverride = process.env.SCOUT_LAUNCH_AGENT_PLIST;
  process.env.SCOUT_LAUNCH_AGENT_PLIST = plist;
  t.after(async () => {
    if (previousOverride === undefined) {
      delete process.env.SCOUT_LAUNCH_AGENT_PLIST;
    } else {
      process.env.SCOUT_LAUNCH_AGENT_PLIST = previousOverride;
    }
    await removeTree(root);
    await fs.rm(home, { recursive: true, force: true });
  });

  return { root, sha, home, plist, legacy };
}

const stubBootstrap = async () => ({ bootstrapped: true, note: "stubbed" });

test("migrateToReleases moves launchd onto current and carries env forward", async (t) => {
  const { root, sha, home, plist, legacy } = await migrationFixture(t);

  const result = await migrateToReleases({
    ...IDLE,
    releaseRoot: root,
    sha,
    home,
    bootstrap: stubBootstrap,
    verify: async () => undefined,
  });

  assert.equal(result.migrated, sha);
  assert.equal(
    await currentReleasePath(root),
    await fs.realpath(path.join(root, "releases", sha)),
  );

  const migrated = await fs.readFile(plist, "utf8");
  assert.match(migrated, /current\/dist\/cli\.js/);
  assert.doesNotMatch(migrated, /workspace\/dist\/cli\.js/);
  // Blocker 4: the var the founder's job actually carries.
  assert.match(
    migrated,
    /<key>SCOUT_SESSION_TIMEOUT_MS<\/key>\s*<string>900000<\/string>/,
  );
  assert.deepEqual(result.carriedEnv, ["SCOUT_SESSION_TIMEOUT_MS"]);
  // The legacy plist has no --port; adding one would move the founder off 47821.
  assert.doesNotMatch(migrated, /--port/);
  assert.equal(result.port, null);

  // Blocker 3: the legacy bytes survive, so the migration is reversible.
  assert.equal(await fs.readFile(result.preservedPlist, "utf8"), legacy);
});

test("a failed migration restores the legacy plist and leaves no current", async (t) => {
  const { root, sha, home, plist, legacy } = await migrationFixture(t);

  await assert.rejects(
    migrateToReleases({
      ...IDLE,
      releaseRoot: root,
      sha,
      home,
      bootstrap: stubBootstrap,
      verify: async () => {
        throw new Error("companion never became ready");
      },
    }),
    /rolled back[\s\S]*companion never became ready/i,
  );

  // The whole point: the founder's launchd config is byte-identical to before.
  assert.equal(await fs.readFile(plist, "utf8"), legacy);
  await assert.rejects(fs.lstat(path.join(root, "current")), /ENOENT/);
});

test("migrateToReleases refuses once current already exists", async (t) => {
  const { root, sha, home } = await migrationFixture(t);

  await migrateToReleases({
    ...IDLE,
    releaseRoot: root,
    sha,
    home,
    bootstrap: stubBootstrap,
    verify: async () => undefined,
  });

  await assert.rejects(
    migrateToReleases({
      ...IDLE,
      releaseRoot: root,
      sha,
      home,
      bootstrap: stubBootstrap,
      verify: async () => undefined,
    }),
    /Already migrated[\s\S]*deploy/,
  );
});

// --- PER-310: the drain is an invariant, and migrate cannot be softened ---
//
// Two CEO AC6 dispositions, one suite each. Both were "fixed" in PER-303 by a
// single assertCompanionIdle call in main(), which satisfied neither: the
// escape hatch reached the first migration, and every programmatic caller
// skipped the drain entirely. Each test below goes red if its half is reverted.
//
// Method note (PER-302 rule 3): a refusal suite needs a control that is
// ACCEPTED, or N refusals only prove the thing refuses everything. The controls
// are "the hatch still opens for a steady-state activation" and the existing
// happy-path tests, which pass an idle companion and succeed.

test("the first migration refuses unknown activity even with SCOUT_ALLOW_UNKNOWN_ACTIVITY=1", async (t) => {
  const { root, sha, home, plist, legacy } = await migrationFixture(t);
  const previous = process.env.SCOUT_ALLOW_UNKNOWN_ACTIVITY;
  process.env.SCOUT_ALLOW_UNKNOWN_ACTIVITY = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.SCOUT_ALLOW_UNKNOWN_ACTIVITY;
    else process.env.SCOUT_ALLOW_UNKNOWN_ACTIVITY = previous;
  });

  await assert.rejects(
    migrateToReleases({
      ...UNKNOWN,
      releaseRoot: root,
      sha,
      home,
      bootstrap: stubBootstrap,
      verify: async () => undefined,
    }),
    /cannot prove the companion is idle/i,
  );

  // The migration boots launchd out and back in, so a refusal has to mean
  // NOTHING moved — not "it refused after repointing current".
  assert.equal(await fs.readFile(plist, "utf8"), legacy);
  await assert.rejects(fs.lstat(path.join(root, "current")), /ENOENT/);
});

test("no caller input can soften the first migration's drain", async (t) => {
  const { root, sha, home } = await migrationFixture(t);

  // migrate takes no allowUnknown parameter at all — passing one is inert
  // rather than honoured. This is the property that makes the hatch
  // structurally unreachable here, not merely unset by the current caller.
  await assert.rejects(
    migrateToReleases({
      ...UNKNOWN,
      allowUnknown: true,
      releaseRoot: root,
      sha,
      home,
      bootstrap: stubBootstrap,
      verify: async () => undefined,
    }),
    /cannot prove the companion is idle/i,
  );
});

test("the unknown-activity hatch still opens for a steady-state activation", async (t) => {
  // The CEO's disposition was that SCOUT_ALLOW_UNKNOWN_ACTIVITY *stays* for
  // routine deploys. Without this control, the migrate tests above would also
  // pass if someone deleted the hatch outright.
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addRelease(releases, "a".repeat(40));
  const releaseB = await addRelease(releases, "b".repeat(40));
  await fs.symlink(releaseA, path.join(root, "current"));

  const restarted = [];
  const result = await activateRelease({
    ...UNKNOWN,
    allowUnknown: true,
    releaseRoot: root,
    sha: "b".repeat(40),
    restart: async (release) => restarted.push(release),
    verify: async () => undefined,
  });

  assert.equal(result.activated, "b".repeat(40));
  assert.deepEqual(restarted, [releaseB]);

  // ...and it is opt-in: the same unknown state refuses when it is not set.
  await fs.rm(path.join(root, "current"));
  await fs.symlink(releaseA, path.join(root, "current"));
  await assert.rejects(
    activateRelease({
      ...UNKNOWN,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async (release) => restarted.push(release),
      verify: async () => undefined,
    }),
    /cannot prove the companion is idle/i,
  );
});

test("a programmatic caller inherits the drain: activateRelease refuses a busy companion", async (t) => {
  // This is the one that would have caught the original defect. It never goes
  // through main(), which is exactly how QA's own AC7 harness bypassed the
  // drain without noticing.
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addRelease(releases, "a".repeat(40));
  await addRelease(releases, "b".repeat(40));
  await fs.symlink(releaseA, path.join(root, "current"));

  const restarted = [];
  await assert.rejects(
    activateRelease({
      ...BUSY,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async (release) => restarted.push(release),
      verify: async () => undefined,
    }),
    /activity is in flight/i,
  );

  assert.deepEqual(restarted, [], "a busy companion is never restarted");
  assert.equal(await currentReleasePath(root), await fs.realpath(releaseA));
});

test("a programmatic caller inherits the drain: migrateToReleases refuses a busy companion", async (t) => {
  const { root, sha, home, plist, legacy } = await migrationFixture(t);

  await assert.rejects(
    migrateToReleases({
      ...BUSY,
      releaseRoot: root,
      sha,
      home,
      bootstrap: stubBootstrap,
      verify: async () => undefined,
    }),
    /activity is in flight/i,
  );

  assert.equal(await fs.readFile(plist, "utf8"), legacy);
  await assert.rejects(fs.lstat(path.join(root, "current")), /ENOENT/);
});

test("the activation path refuses a caller that cannot prove idleness at all", async (t) => {
  // Omitting the origin must be a REFUSAL, not a skip. A default that made the
  // check inert when unconfigured would rebuild the exact bypass this issue is
  // about — and this tree has already lost two cycles to guards that were
  // structurally incapable of failing.
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addRelease(releases, "a".repeat(40));
  await addRelease(releases, "b".repeat(40));
  await fs.symlink(releaseA, path.join(root, "current"));

  await assert.rejects(
    activateRelease({
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async () => undefined,
      verify: async () => undefined,
    }),
    /activate requires an origin/i,
  );

  const migration = await migrationFixture(t);
  await assert.rejects(
    migrateToReleases({
      releaseRoot: migration.root,
      sha: migration.sha,
      home: migration.home,
      bootstrap: stubBootstrap,
      verify: async () => undefined,
    }),
    /migrate requires an origin/i,
  );
  assert.equal(await fs.readFile(migration.plist, "utf8"), migration.legacy);
});

// --- PER-303 blocker 7: provenance checks that can actually fail ----------
//
// Both fixtures used to serve /v0/version and /scout-build.json from the same
// field, so verifyRelease's cross-check could not fail by construction. These
// derive the two sides independently and assert each refusal goes red.

function provenanceFetch({
  gitSha,
  manifestBuildId,
  servedBuildId,
  activityInFlight = false,
}) {
  return async (url) => {
    const json = (body) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/v0/version")) {
      return json({
        ok: true,
        git_sha: gitSha,
        next_build_id: manifestBuildId,
        activity_in_flight: activityInFlight,
      });
    }
    if (url.endsWith("/scout-build.json")) {
      return json({ next_build_id: servedBuildId });
    }
    if (url.endsWith("/app/")) return new Response("<html></html>");
    return new Response("missing", { status: 404 });
  };
}

test("verifyRelease refuses when the served UI is staler than the manifest", async () => {
  const sha = "f".repeat(40);
  await assert.rejects(
    verifyRelease({
      origin: "http://127.0.0.1:1",
      sha,
      attempts: 1,
      fetchImpl: provenanceFetch({
        gitSha: sha,
        // The backend advanced; the webroot did not. This is the stale-webroot
        // deploy the cross-check exists to catch.
        manifestBuildId: "ui-new",
        servedBuildId: "ui-old",
      }),
    }),
    /served UI build ui-old does not match[\s\S]*ui-new/,
  );
});

test("verifyRelease accepts only when both halves agree", async () => {
  const sha = "f".repeat(40);
  const version = await verifyRelease({
    origin: "http://127.0.0.1:1",
    sha,
    attempts: 1,
    fetchImpl: provenanceFetch({
      gitSha: sha,
      manifestBuildId: "ui-same",
      servedBuildId: "ui-same",
    }),
  });
  assert.equal(version.git_sha, sha);
  assert.equal(version.next_build_id, "ui-same");
});

test("verifyRelease refuses a backend reporting a different commit", async () => {
  await assert.rejects(
    verifyRelease({
      origin: "http://127.0.0.1:1",
      sha: "f".repeat(40),
      attempts: 1,
      fetchImpl: provenanceFetch({
        gitSha: "0".repeat(40),
        manifestBuildId: "ui-x",
        servedBuildId: "ui-x",
      }),
    }),
    /\/v0\/version reported 0{40}, expected f{40}/,
  );
});

test("verifyRelease refuses when the backend reports no UI build ID", async () => {
  const sha = "f".repeat(40);
  await assert.rejects(
    verifyRelease({
      origin: "http://127.0.0.1:1",
      sha,
      attempts: 1,
      fetchImpl: provenanceFetch({
        gitSha: sha,
        manifestBuildId: null,
        servedBuildId: "ui-x",
      }),
    }),
    /did not report a UI build ID/,
  );
});

test("activation verification catches a release whose served UI is stale", async (t) => {
  const { root, releases } = await tempReleaseRoot();
  t.after(() => removeTree(root));
  const releaseA = await addFakeCompanion(releases, "a".repeat(40), "ui-a");
  await addFakeCompanion(releases, "b".repeat(40), "ui-b", {
    // Release B ships a new manifest but serves A's webroot.
    servedBuildId: "ui-a",
  });
  await fs.symlink(releaseA, path.join(root, "current"));

  await assert.rejects(
    activateRelease({
      ...IDLE,
      releaseRoot: root,
      sha: "b".repeat(40),
      restart: async () => undefined,
      verify: async ({ sha }) => {
        const release = JSON.parse(
          await fs.readFile(path.join(releases, sha, "release.json"), "utf8"),
        );
        if (release.served_build_id !== release.next_build_id) {
          throw new Error(
            `served UI build ${release.served_build_id} does not match ${release.next_build_id}`,
          );
        }
      },
    }),
    /rolled back[\s\S]*served UI build ui-a does not match ui-b/i,
  );
  assert.equal(await currentReleasePath(root), await fs.realpath(releaseA));
});
