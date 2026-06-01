// End-to-end loopback test: boots the server with a stubbed `claude` binary,
// then drives POST /v0/interests → poll GET /v0/briefs.
//
// The stub `claude` ignores its args and prints a fixed brief, so we don't
// hit the real network or require the user's Claude Code OAuth.
//
// Run with: pnpm --filter @scout/agent test
//
// Uses node:assert + node:test so we don't add a test-runner dependency.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveState, newPairingToken, type Brief } from "../src/state.js";
import { startServer } from "../src/server.js";

async function makeStubClaude(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-stub-"));
  const bin = path.join(dir, "claude");
  // Drains stdin (the prompt) and prints a canned brief. The shape mirrors
  // what `claude --print` would emit so the companion's parse path is real.
  const script = `#!/usr/bin/env bash\ncat >/dev/null\nprintf '# Your brief\\n\\n## test\\n- stubbed research run\\n  [example.com — Demo](https://example.com)\\n'\n`;
  await fs.writeFile(bin, script, { mode: 0o755 });
  return bin;
}

test("loopback round-trip: pair → POST interests → poll briefs", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const claudeBin = await makeStubClaude();

  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));

  const { server, port } = await startServer(0, {
    stateFile,
    claudeBin,
    onSynthesisDone: (b) => synthesisDone(b),
  });

  try {
    // 1. /healthz, no auth.
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).ok, true);

    // 2. POST /v0/interests without auth -> 401.
    const unauth = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interests: ["llm research"] }),
    });
    assert.equal(unauth.status, 401);

    // 3. POST /v0/interests with auth -> 202.
    const since = new Date(Date.now() - 1000).toISOString();
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ interests: ["llm research", "ai safety"] }),
    });
    assert.equal(kick.status, 202);
    const kickBody = await kick.json();
    assert.ok(kickBody.brief_id);

    // 4. Wait for synthesis to finish.
    const brief = await doneP;
    assert.equal(brief.status, "ready");
    assert.match(brief.summary_md ?? "", /Your brief/);

    // 5. Poll GET /v0/briefs?since=...
    const poll = await fetch(
      `http://127.0.0.1:${port}/v0/briefs?since=${encodeURIComponent(since)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(poll.status, 200);
    const pollBody = await poll.json();
    assert.equal(pollBody.briefs.length, 1);
    assert.equal(pollBody.briefs[0].status, "ready");

    // 6. Future `since` filters it out.
    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await fetch(
      `http://127.0.0.1:${port}/v0/briefs?since=${encodeURIComponent(future)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.deepEqual((await empty.json()).briefs, []);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(path.dirname(claudeBin), { recursive: true, force: true });
  }
});

test("OPTIONS preflight grants Private Network Access for allowed origins (PER-107)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  await saveState({ pairing_token: newPairingToken() }, stateFile);

  const { server, port } = await startServer(0, { stateFile });

  try {
    // A real Chrome PNA preflight from the public github.io origin: it carries
    // both Origin and Access-Control-Request-Private-Network: true.
    const githubOrigin = "https://hakon1233.github.io";
    const preflight = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "OPTIONS",
      headers: {
        origin: githubOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
        "access-control-request-private-network": "true",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-private-network"),
      "true",
    );
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      githubOrigin,
    );

    // A preflight WITHOUT the PNA request header must not get the grant.
    const noPna = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "OPTIONS",
      headers: { origin: githubOrigin, "access-control-request-method": "POST" },
    });
    assert.equal(noPna.status, 204);
    assert.equal(
      noPna.headers.get("access-control-allow-private-network"),
      null,
    );

    // A PNA preflight from a disallowed origin gets neither CORS nor the grant.
    const badOrigin = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
        "access-control-request-private-network": "true",
      },
    });
    assert.equal(badOrigin.status, 204);
    assert.equal(
      badOrigin.headers.get("access-control-allow-private-network"),
      null,
    );
    assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
  }
});

test("POST /v0/interests returns 409 while a brief is pending (PER-92)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  // Seed state with a pending brief — simulates an in-flight synth.
  await saveState(
    {
      pairing_token: token,
      last_brief: {
        id: "in-flight-id",
        generated_at: new Date().toISOString(),
        status: "pending",
      },
    },
    stateFile,
  );

  const claudeBin = await makeStubClaude();
  const { server, port } = await startServer(0, { stateFile, claudeBin });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ interests: ["llm research"] }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.brief_id, "in-flight-id");
    assert.match(body.error, /in progress/);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(path.dirname(claudeBin), { recursive: true, force: true });
  }
});

test("GET /v0/briefs + /healthz stay responsive during synthesis (PER-101)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  // A stub `claude` that holds the subprocess open for ~2.5s and burns CPU the
  // whole time — stands in for the heavy real agent. If the request handler
  // ever blocks the event loop on the in-flight child (e.g. a switch to a
  // synchronous spawn / blocking read), the polls below would hang and the
  // latency assertion would fail. This is the guard for the PER-101 contract:
  // synthesis is fire-and-forget and the server keeps answering.
  const dir = path.dirname(stateFile);
  const claudeBin = path.join(dir, "claude-busy");
  const busy = `#!/usr/bin/env node\ncat=process.stdin.resume();\nconst end=Date.now()+2500;\nwhile(Date.now()<end){Math.sqrt(Math.random());}\nprocess.stdout.write('# Your brief\\n\\n## x\\n- ok\\n  [example.com — D](https://example.com)\\n');\n`;
  await fs.writeFile(claudeBin, busy, { mode: 0o755 });

  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    claudeBin,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["ai policy", "nba"] }),
    });
    assert.equal(kick.status, 202);

    // Poll while the child is in flight. Each poll must come back quickly and
    // report `pending`, exactly what the web app needs to render live progress.
    let sawPending = false;
    for (let i = 0; i < 4; i++) {
      const t0 = Date.now();
      const [briefs, health] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/v0/briefs`, { headers: auth }),
        fetch(`http://127.0.0.1:${port}/healthz`),
      ]);
      const elapsed = Date.now() - t0;
      assert.equal(briefs.status, 200);
      assert.equal(health.status, 200);
      assert.ok(
        elapsed < 1000,
        `poll #${i} took ${elapsed}ms during synthesis (expected < 1000ms)`,
      );
      const body = await briefs.json();
      if (body.briefs[0]?.status === "pending") sawPending = true;
      await new Promise((res) => setTimeout(res, 400));
    }
    assert.ok(sawPending, "expected to observe a pending brief during synthesis");

    const brief = await doneP;
    assert.equal(brief.status, "ready");
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
  }
});

test("POST /v0/interests rejects >6 interests with 400 (PER-91)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const claudeBin = await makeStubClaude();
  const { server, port } = await startServer(0, { stateFile, claudeBin });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        interests: ["a", "b", "c", "d", "e", "f", "g"],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too many interests/);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(path.dirname(claudeBin), { recursive: true, force: true });
  }
});

test("POST /v0/interests de-duplicates before the max-6 budget check (PER-126)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const claudeBin = await makeStubClaude();
  const { server, port } = await startServer(0, { stateFile, claudeBin });

  try {
    // 7 raw items but only 6 unique after case-insensitive de-dup ("AI safety"
    // appears twice). The dupe must be collapsed BEFORE the max-6 check, so this
    // is accepted (202) rather than rejected as ">6". Pre-PER-126 this 400'd.
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        interests: ["AI safety", "ai safety", "nba", "f1", "climate", "rust", "go"],
      }),
    });
    assert.equal(res.status, 202);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(path.dirname(claudeBin), { recursive: true, force: true });
  }
});

// PER-110: the companion serves the web UI from its own loopback origin so the
// page is same-origin with the API → no Local Network Access prompt. Two parts
// are tested here: the /v0/config token bootstrap and the static file fallback.

test("GET /v0/config hands the token to a same-origin caller, refuses cross-origin", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const { server, port } = await startServer(0, { stateFile });
  try {
    // Same-origin: browsers omit Origin for same-origin GETs.
    const noOrigin = await fetch(`http://127.0.0.1:${port}/v0/config`);
    assert.equal(noOrigin.status, 200);
    assert.equal((await noOrigin.json()).token, token);

    // Explicit loopback origin (the served UI) also gets the token.
    const loopback = await fetch(`http://127.0.0.1:${port}/v0/config`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(loopback.status, 200);
    assert.equal((await loopback.json()).token, token);

    // A public cross-origin caller is refused — the token must never leak to
    // github.io even if the browser's LNA gate somehow let the request through.
    const cross = await fetch(`http://127.0.0.1:${port}/v0/config`, {
      headers: { origin: "https://hakon1233.github.io" },
    });
    assert.equal(cross.status, 403);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
  }
});

test("serves the bundled static UI for non-API GETs (PER-110)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  await saveState({ pairing_token: newPairingToken() }, stateFile);

  // A throwaway webroot mirroring the Next export layout (index.html, /app/,
  // hashed _next asset) — no dependency on a prior `next build`.
  const webroot = await fs.mkdtemp(path.join(os.tmpdir(), "scout-webroot-"));
  await fs.writeFile(path.join(webroot, "index.html"), "<!doctype html><title>root</title>");
  await fs.mkdir(path.join(webroot, "app"), { recursive: true });
  await fs.writeFile(path.join(webroot, "app", "index.html"), "<!doctype html><title>app</title>");
  await fs.mkdir(path.join(webroot, "_next", "static"), { recursive: true });
  await fs.writeFile(path.join(webroot, "_next", "static", "x.js"), "console.log(1)");

  const { server, port } = await startServer(0, { stateFile, webroot });
  try {
    // Root → index.html.
    const root = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await root.text(), /<title>root<\/title>/);

    // Directory route /app/ → app/index.html.
    const app = await fetch(`http://127.0.0.1:${port}/app/`);
    assert.equal(app.status, 200);
    assert.match(await app.text(), /<title>app<\/title>/);

    // Hashed asset → immutable cache + JS content-type.
    const asset = await fetch(`http://127.0.0.1:${port}/_next/static/x.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

    // API routes still win over the static fallback.
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    // Path traversal is refused (resolves outside webroot → 404, not the state file).
    const evil = await fetch(`http://127.0.0.1:${port}/../../../etc/passwd`);
    assert.equal(evil.status, 404);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(webroot, { recursive: true, force: true });
  }
});
