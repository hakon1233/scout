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
