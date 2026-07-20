import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
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
  stagePackedRelease,
  verifyRelease,
} from "../scripts/release-agent.mjs";

const execFileP = promisify(execFile);

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
  { fail = false } = {},
) {
  const dir = await addRelease(releases, sha, nextBuildId);
  await fs.writeFile(
    path.join(dir, "release.json"),
    `${JSON.stringify({ sha, next_build_id: nextBuildId, fail })}\n`,
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
  if (req.url === "/v0/version") res.end(JSON.stringify({ ok: true, git_sha: release.sha, next_build_id: release.next_build_id, activity_in_flight: false }));
  else if (req.url === "/app/") res.end('<link href="/_next/static/media/font.woff2"><script src="/_next/static/chunks/app.js"></script>');
  else if (req.url === "/scout-build.json") res.end(JSON.stringify({ next_build_id: release.next_build_id }));
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

test("stagePackedRelease authors clean provenance and freezes the SHA directory", async (t) => {
  const { root } = await tempReleaseRoot();
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), "scout-packed-agent-"),
  );
  const packageDir = path.join(fixture, "package");
  const sha = "c".repeat(40);
  await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
  await fs.mkdir(path.join(packageDir, "webroot", "app"), { recursive: true });
  await fs.writeFile(
    path.join(packageDir, "dist", "build-info.json"),
    `${JSON.stringify({
      git_sha: `${sha}-dirty`,
      git_sha_short: "ccccccc-dirty",
      next_build_id: "ui-c",
      built_at: "2026-07-20T00:00:00.000Z",
    })}\n`,
  );
  await fs.writeFile(
    path.join(packageDir, "webroot", "app", "index.html"),
    '<link href="/_next/static/media/font.woff2"><script src="/_next/static/chunks/app.js"></script>\n',
  );
  await fs.writeFile(
    path.join(packageDir, "webroot", "scout-build.json"),
    `${JSON.stringify({ next_build_id: "ui-c" })}\n`,
  );
  await fs.writeFile(
    path.join(packageDir, "package.json"),
    '{"name":"@scout/agent"}\n',
  );
  const tarball = path.join(fixture, "scout-agent.tgz");
  await execFileP("tar", ["-czf", tarball, "package"], { cwd: fixture });
  t.after(async () => {
    await removeTree(root);
    await fs.rm(fixture, { recursive: true, force: true });
  });

  const releasePath = await stagePackedRelease({
    tarball,
    releaseRoot: root,
    sha,
    shortSha: "ccccccc",
  });

  assert.equal(releasePath, path.join(root, "releases", sha));
  const buildInfo = JSON.parse(
    await fs.readFile(
      path.join(releasePath, "dist", "build-info.json"),
      "utf8",
    ),
  );
  assert.equal(buildInfo.git_sha, sha);
  assert.equal(buildInfo.git_sha_short, "ccccccc");
  assert.equal(buildInfo.next_build_id, "ui-c");
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(releasePath, "release.json"), "utf8"),
    ),
    { sha, next_build_id: "ui-c", built_at: "2026-07-20T00:00:00.000Z" },
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
      assert.equal(
        (
          await execFileP("git", ["rev-parse", "HEAD"], { cwd: worktree })
        ).stdout.trim(),
        sha,
      );
      const packageDir = path.join(worktree, "package");
      await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
      await fs.mkdir(path.join(packageDir, "webroot", "app"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(packageDir, "dist", "build-info.json"),
        `${JSON.stringify({ next_build_id: "ui-release", built_at: "now" })}\n`,
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
  await activateRelease({ releaseRoot: root, sha: shaB, restart, verify });
  assert.equal((await fs.readFile(stateFile, "utf8")).trim(), shaB);
  assert.equal(await currentReleasePath(root), await fs.realpath(releaseB));

  await assert.rejects(
    activateRelease({
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
