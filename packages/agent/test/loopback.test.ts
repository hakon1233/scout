// End-to-end loopback test: boots the server with a stubbed `claude` binary,
// then drives POST /v0/interests → poll GET /v0/briefs.
//
// The stub `claude` ignores its args and prints a fixed brief, so we don't
// hit the real network or require the user's Claude Code OAuth.
//
// Run with: pnpm --filter @notiva/agent test
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notiva-stub-"));
  const bin = path.join(dir, "claude");
  // Drains stdin (the prompt) and prints a canned brief. The shape mirrors
  // what `claude --print` would emit so the companion's parse path is real.
  const script = `#!/usr/bin/env bash\ncat >/dev/null\nprintf '# Your brief\\n\\n## test\\n- stubbed research run\\n  [example.com — Demo](https://example.com)\\n'\n`;
  await fs.writeFile(bin, script, { mode: 0o755 });
  return bin;
}

test("loopback round-trip: pair → POST interests → poll briefs", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "notiva-state-"));
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
