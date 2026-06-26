// GET /v0/version build-provenance contract (PER-239).
//
// QA gates byte-match `git_sha` against the commit under test, so this pins:
//   - the response shape (ok/version/git_sha/git_sha_short/next_build_id/built_at),
//   - that the endpoint needs NO auth (QA curls it before pairing),
//   - honest degradation: a build without dist/build-info.json answers 200
//     with null provenance, never a 500,
//   - /healthz carries the folded-in git_sha.
//
// Hermetic: build info is injected via deps.buildInfoFile; no git, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveState, newPairingToken } from "../src/state.js";
import { startServer, PKG_VERSION } from "../src/server.js";

async function seeded() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-version-"));
  const stateFile = path.join(tmp, "state.json");
  await saveState({ pairing_token: newPairingToken() }, stateFile);
  return { tmp, stateFile };
}

test("GET /v0/version returns baked build provenance without auth (PER-239)", async () => {
  const { tmp, stateFile } = await seeded();
  const buildInfoFile = path.join(tmp, "build-info.json");
  const baked = {
    git_sha: "96ddc35aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    git_sha_short: "96ddc35",
    next_build_id: "test-build-id",
    built_at: "2026-06-11T00:00:00.000Z",
  };
  await fs.writeFile(buildInfoFile, JSON.stringify(baked));

  const { server, port } = await startServer(0, { stateFile, buildInfoFile });
  try {
    // No Authorization header on purpose — QA hits this before pairing.
    const res = await fetch(`http://127.0.0.1:${port}/v0/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, version: PKG_VERSION, ...baked });

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).git_sha, baked.git_sha);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /v0/version degrades to null provenance when build-info.json is missing", async () => {
  const { tmp, stateFile } = await seeded();
  const { server, port } = await startServer(0, {
    stateFile,
    buildInfoFile: path.join(tmp, "no-such-build-info.json"),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      version: PKG_VERSION,
      git_sha: null,
      git_sha_short: null,
      next_build_id: null,
      built_at: null,
    });
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /v0/version degrades to null provenance when build-info.json is malformed (AIR-343)", async () => {
  const { tmp, stateFile } = await seeded();
  const buildInfoFile = path.join(tmp, "build-info.json");
  // A truncated / corrupted artifact (e.g. interrupted build write): valid file,
  // invalid JSON. Must degrade to null provenance, never 500 the endpoint.
  await fs.writeFile(buildInfoFile, '{"git_sha": "96ddc35", ');

  const { server, port } = await startServer(0, { stateFile, buildInfoFile });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      version: PKG_VERSION,
      git_sha: null,
      git_sha_short: null,
      next_build_id: null,
      built_at: null,
    });

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).git_sha, null);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DEFAULT_PORT falls back when SCOUT_AGENT_PORT is malformed", async () => {
  const previous = process.env.SCOUT_AGENT_PORT;
  process.env.SCOUT_AGENT_PORT = "not-a-number";
  try {
    const mod = await import(`../src/server.js?air322=${Date.now()}`);
    assert.equal(mod.DEFAULT_PORT, 47821);
  } finally {
    if (previous === undefined) delete process.env.SCOUT_AGENT_PORT;
    else process.env.SCOUT_AGENT_PORT = previous;
  }
});
