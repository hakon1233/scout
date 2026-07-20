import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { promisify } from "node:util";
import {
  activateRelease,
  currentReleasePath,
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

async function addRelease(releases, sha, nextBuildId, { fail = false } = {}) {
  const dir = path.join(releases, sha);
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.mkdir(path.join(dir, "webroot"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "release.json"),
    `${JSON.stringify({ sha, next_build_id: nextBuildId, fail })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "dist", "build-info.json"),
    `${JSON.stringify({ git_sha: sha, next_build_id: nextBuildId })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "webroot", "scout-build.json"),
    `${JSON.stringify({ next_build_id: nextBuildId })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "server.mjs"),
    `import http from "node:http";
import { promises as fs } from "node:fs";
const release = JSON.parse(await fs.readFile(new URL("./release.json", import.meta.url), "utf8"));
if (release.fail) process.exit(42);
await fs.writeFile(process.argv[3], release.sha + "\\n");
http.createServer((req, res) => {
  if (req.url === "/v0/version") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, git_sha: release.sha, next_build_id: release.next_build_id, activity_in_flight: false }));
  } else if (req.url === "/app/") {
    res.setHeader("content-type", "text/html");
    res.end('<link href="/_next/static/media/font.woff2"><script src="/_next/static/chunks/app.js"></script>');
  } else if (req.url === "/scout-build.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ next_build_id: release.next_build_id }));
  } else { res.statusCode = 404; res.end("missing"); }
}).listen(Number(process.argv[2]), "127.0.0.1");
`,
  );
  return dir;
}

// PER-303 blocker 6: this file was named *.spike.mjs, which the `test/*.test.mjs`
// glob does not match — it never ran, so it was not evidence about anything.
//
// Its plist is hand-rolled on purpose: what this exercises is the `current`
// symlink flip and the rollback of a failing release through REAL launchd, on a
// unique temporary label (ing.scout.agent.per301.<pid>), port and state dir, so
// it can never touch the founder's job. The legacy->current transition, which
// must drive the real installService, is covered in release-agent.test.mjs
// ("migrateToReleases ...") — a hand-rolled plist would prove nothing there.

test(
  "macOS launchd spike switches A to B through stable current and rolls failed C back to B",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "scout-launchd-release-"),
    );
    const releases = path.join(root, "releases");
    const stateFile = path.join(root, "state", "started-sha");
    const logFile = path.join(root, "launchd.log");
    const plist = path.join(root, "agent.plist");
    const label = `ing.scout.agent.per301.${process.pid}`;
    const domain = `gui/${process.getuid()}`;
    const target = `${domain}/${label}`;
    const port = await freePort();
    // PER-310: the drain is an invariant inside activateRelease, so the spike
    // now proves it against the REAL launchd-managed companion — real fetch,
    // real /v0/version, no stub. Activation refuses unless this origin answers
    // that nothing is in flight.
    const origin = `http://127.0.0.1:${port}`;
    const shaA = "a".repeat(40);
    const shaB = "b".repeat(40);
    const shaFail = "f".repeat(40);
    await fs.mkdir(releases, { recursive: true });
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const releaseA = await addRelease(releases, shaA, "ui-a");
    const releaseB = await addRelease(releases, shaB, "ui-b");
    await addRelease(releases, shaFail, "ui-fail", { fail: true });
    await fs.symlink(releaseA, path.join(root, "current"));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>
<string>${process.execPath}</string>
<string>${path.join(root, "current", "server.mjs")}</string>
<string>${port}</string>
<string>${stateFile}</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>WorkingDirectory</key><string>${root}</string>
<key>StandardOutPath</key><string>${logFile}</string>
<key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>\n`;
    await fs.writeFile(plist, xml);

    async function bootout() {
      await execFileP("launchctl", ["bootout", target]).catch(() => undefined);
    }
    async function restart() {
      await execFileP("launchctl", ["kickstart", "-k", target]);
    }
    async function verify({ sha }) {
      await verifyRelease({
        origin,
        sha,
        attempts: 50,
        delayMs: 20,
      });
    }

    t.after(async () => {
      await bootout();
      await removeTree(root);
    });

    await bootout();
    await execFileP("launchctl", ["bootstrap", domain, plist]);
    await verify({ sha: shaA });

    await activateRelease({
      origin,
      releaseRoot: root,
      sha: shaB,
      restart,
      verify,
    });
    assert.equal((await fs.readFile(stateFile, "utf8")).trim(), shaB);
    assert.equal(await currentReleasePath(root), await fs.realpath(releaseB));

    await assert.rejects(
      activateRelease({
        origin,
        releaseRoot: root,
        sha: shaFail,
        restart,
        verify,
      }),
      /rolled back/i,
    );
    assert.equal((await fs.readFile(stateFile, "utf8")).trim(), shaB);
    assert.equal(await currentReleasePath(root), await fs.realpath(releaseB));
  },
);
