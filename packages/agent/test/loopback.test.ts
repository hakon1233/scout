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
import { saveState, loadState, newPairingToken, type Brief, type State } from "../src/state.js";
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

test("POST /v0/interests rejects an oversized body with 413 (PER-137)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const claudeBin = await makeStubClaude();
  const { server, port } = await startServer(0, { stateFile, claudeBin });

  try {
    // ~2 MB single interest — the original repro. Must 413 (not 202), and no
    // synthesis is started.
    const huge = "A".repeat(2_000_000);
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ interests: [huge] }),
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /too large/);

    // No brief slot was consumed.
    const state = await loadState(stateFile);
    assert.equal(state.last_brief, undefined);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(path.dirname(claudeBin), { recursive: true, force: true });
  }
});

test("POST /v0/interests rejects an over-long single interest with 400 (PER-137)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const claudeBin = await makeStubClaude();
  const { server, port } = await startServer(0, { stateFile, claudeBin });

  try {
    // Under the body cap but a single interest longer than MAX_INTEREST_LEN
    // (201 chars) — must 400, not 202.
    const tooLong = "a".repeat(201);
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ interests: [tooLong] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /interest too long/);

    const state = await loadState(stateFile);
    assert.equal(state.last_brief, undefined);
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
  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    claudeBin,
    onSynthesisDone: (b) => synthesisDone(b),
  });

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
    const brief = await doneP;
    assert.equal(brief.status, "ready");
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

// PER-157: the companion is the source of truth for the user's interests, so it
// hands them to a same-origin caller alongside the token. This lets a browser
// with no locally-saved settings (cleared storage / different profile / a
// different origin than first-run setup) recover the interests and render a
// working brief instead of dead-ending on the setup form. Empty when none yet.
test("GET /v0/config returns the persisted interests to a same-origin caller", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();

  const { server, port } = await startServer(0, { stateFile });
  try {
    // No interests stored yet → an empty array, never undefined.
    await saveState({ pairing_token: token }, stateFile);
    const empty = await fetch(`http://127.0.0.1:${port}/v0/config`);
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).interests, []);

    // With interests persisted, they're echoed verbatim and in order.
    // NB: this seeds the LEGACY string[] on-disk shape on purpose — loadState
    // migrates it to {id, topic} and /v0/config flattens back to topics, so this
    // doubles as a back-compat check that old state.json files still serve.
    await saveState(
      {
        pairing_token: token,
        interests: ["ai", "anthropic", "openai"],
      } as unknown as State,
      stateFile,
    );
    const withInterests = await fetch(`http://127.0.0.1:${port}/v0/config`);
    assert.equal(withInterests.status, 200);
    assert.deepEqual((await withInterests.json()).interests, [
      "ai",
      "anthropic",
      "openai",
    ]);

    // Cross-origin is still refused — interests don't leak to a public origin.
    const cross = await fetch(`http://127.0.0.1:${port}/v0/config`, {
      headers: { origin: "https://hakon1233.github.io" },
    });
    assert.equal(cross.status, 403);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
  }
});

// PER-135: the cross-origin origin-deny guard must be uniform across the whole
// /v0/* surface. Previously only /v0/config 403'd a hostile Origin; /v0/briefs
// and /v0/interests served it (no ACAO, so unreadable in a browser, but the
// posture was inconsistent — a defense-in-depth gap). Now every /v0/* route
// rejects a non-allowlisted Origin with 403, while allowlisted app origins and
// no-Origin (non-browser) callers still pass.
test("a hostile Origin is 403'd uniformly across all /v0/* routes (PER-135)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const { server, port } = await startServer(0, { stateFile });
  const evil = "http://evil.com";
  const allowlisted = "https://hakon1233.github.io";
  try {
    // /v0/config (no token), /v0/briefs and /v0/interests (valid token) all
    // reject the hostile Origin with 403 before any handler runs. A valid
    // bearer token does NOT buy a hostile origin a 200.
    const configEvil = await fetch(`http://127.0.0.1:${port}/v0/config`, {
      headers: { origin: evil },
    });
    assert.equal(configEvil.status, 403);

    const briefsEvil = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: { origin: evil, authorization: `Bearer ${token}` },
    });
    assert.equal(briefsEvil.status, 403);
    assert.equal(briefsEvil.headers.get("access-control-allow-origin"), null);

    const interestsEvil = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        origin: evil,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ interests: ["ai"] }),
    });
    assert.equal(interestsEvil.status, 403);

    // An allowlisted app origin still reaches /v0/briefs (briefs are meant to be
    // read cross-origin by the hosted UI) — it gets a 200 with a proper ACAO,
    // not a 403. (/v0/config stays stricter: same-origin only, covered above.)
    const briefsApp = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: { origin: allowlisted, authorization: `Bearer ${token}` },
    });
    assert.equal(briefsApp.status, 200);
    assert.equal(
      briefsApp.headers.get("access-control-allow-origin"),
      allowlisted,
    );

    // No-Origin (non-browser) caller is unaffected by the origin gate; it still
    // gets through to bearer auth and serves.
    const briefsNoOrigin = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(briefsNoOrigin.status, 200);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
  }
});

// PER-157: the founder reaches the companion over his Tailscale tailnet
// (`https://<machine>.<tailnet>.ts.net`), NOT loopback. A browser there sends
// that Origin on every write, so the run trigger `POST /v0/interests` (and the
// profile/schedule PUTs) must NOT be 403'd by the origin gate — that was the
// founder's "Run now doesn't work". A `.ts.net` origin is allowlisted; briefs
// also get a proper ACAO so the cross-origin UI can read them.
test("founder's Tailscale .ts.net origin reaches the run path, not a 403 (PER-157)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const claudeBin = await makeStubClaude();

  // The 202 path fires synthesis asynchronously and writes the brief back to
  // state.json. Capture completion so we can drain the in-flight run before
  // tearing down tmpStateDir — otherwise a late saveState() races the fs.rm
  // and rejects with ENOENT (unhandledRejection → flaky CI fail). Same pattern
  // as the round-trip test above.
  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));

  const { server, port } = await startServer(0, {
    stateFile,
    claudeBin,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const tailnetOrigin = "https://openhakons-mac-mini.taildc1287.ts.net:48721";
  try {
    // The run trigger over the tailnet origin is accepted (202), not 403'd.
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: {
        origin: tailnetOrigin,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ interests: ["ai"] }),
    });
    assert.equal(kick.status, 202);
    assert.equal(
      kick.headers.get("access-control-allow-origin"),
      tailnetOrigin,
    );

    // Briefs are readable cross-origin from the tailnet UI (200 + ACAO).
    const briefs = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: { origin: tailnetOrigin, authorization: `Bearer ${token}` },
    });
    assert.equal(briefs.status, 200);
    assert.equal(
      briefs.headers.get("access-control-allow-origin"),
      tailnetOrigin,
    );

    // A look-alike that is NOT a .ts.net host is still rejected — the allowlist
    // did not turn into a wildcard.
    const evil = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: {
        origin: "https://openhakons-mac-mini.taildc1287.ts.net.evil.com",
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(evil.status, 403);

    // Drain the in-flight synthesis kicked off by the 202 above, so its
    // saveState() to state.json completes before the finally removes the dir.
    await doneP;
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(path.dirname(claudeBin), { recursive: true, force: true });
  }
});

// PER-136: a wrong method on a KNOWN /v0/* route must return 405 Method Not
// Allowed with an `Allow` header listing the valid methods — distinguishable
// from the 404 a genuinely unknown path gets. An unknown path still 404s.
test("wrong method on a known /v0/* route → 405 + Allow; unknown path → 404 (PER-136)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);

  const { server, port } = await startServer(0, { stateFile });
  const auth = { authorization: `Bearer ${token}` };
  try {
    // DELETE/POST on the GET-only /v0/config → 405, Allow: GET, OPTIONS.
    const cfgDelete = await fetch(`http://127.0.0.1:${port}/v0/config`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(cfgDelete.status, 405);
    assert.equal(cfgDelete.headers.get("allow"), "GET, OPTIONS");
    assert.equal((await cfgDelete.json()).error, "method not allowed");

    // DELETE on /v0/interests (GET/POST/PUT only, PER-169 added GET) → 405,
    // Allow: GET, POST, PUT, OPTIONS.
    const interestsDelete = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(interestsDelete.status, 405);
    assert.equal(interestsDelete.headers.get("allow"), "GET, POST, PUT, OPTIONS");

    // PUT on the GET-only /v0/briefs → 405, Allow: GET, OPTIONS.
    const briefsPut = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      method: "PUT",
      headers: auth,
    });
    assert.equal(briefsPut.status, 405);
    assert.equal(briefsPut.headers.get("allow"), "GET, OPTIONS");

    // A genuinely unknown /v0/* path still 404s (no Allow header) — the 405
    // path must not swallow real not-found cases.
    const unknown = await fetch(`http://127.0.0.1:${port}/v0/nonsense`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get("allow"), null);
    assert.equal((await unknown.json()).error, "not found");
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

// PER-127: deep-linking / refreshing an in-app view (a panel at /app/, not a
// real export route) must land on the app shell instead of a hard 404; and a
// directory route hit without its trailing slash should 301 like GitHub Pages.
test("SPA fallback + trailing-slash parity for the bundled UI (PER-127)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  await saveState({ pairing_token: newPairingToken() }, stateFile);

  // Webroot mirroring the Next `trailingSlash: true` export: /app/ and
  // /app/connect/ are directory routes; there is NO /app/settings route.
  const webroot = await fs.mkdtemp(path.join(os.tmpdir(), "scout-webroot-"));
  await fs.writeFile(path.join(webroot, "index.html"), "<!doctype html><title>root</title>");
  await fs.mkdir(path.join(webroot, "app"), { recursive: true });
  await fs.writeFile(path.join(webroot, "app", "index.html"), "<!doctype html><title>app</title>");
  await fs.mkdir(path.join(webroot, "app", "connect"), { recursive: true });
  await fs.writeFile(
    path.join(webroot, "app", "connect", "index.html"),
    "<!doctype html><title>connect</title>",
  );

  const { server, port } = await startServer(0, { stateFile, webroot });
  try {
    // /app/settings has no route → fall back to the app shell (200), not 404.
    const settings = await fetch(`http://127.0.0.1:${port}/app/settings`);
    assert.equal(settings.status, 200);
    assert.match(await settings.text(), /<title>app<\/title>/);

    // Same for a nested in-app deep-link.
    const nested = await fetch(`http://127.0.0.1:${port}/app/settings/keys`);
    assert.equal(nested.status, 200);
    assert.match(await nested.text(), /<title>app<\/title>/);

    // /app/connect (no trailing slash) → 301 to /app/connect/, matching the
    // GitHub Pages / Next trailingSlash behavior.
    const connect = await fetch(`http://127.0.0.1:${port}/app/connect`, {
      redirect: "manual",
    });
    assert.equal(connect.status, 301);
    assert.equal(connect.headers.get("location"), "/app/connect/");

    // The fallback is scoped to /app and to extensionless navigations: an
    // unknown top-level route and a missing asset both still 404.
    const top = await fetch(`http://127.0.0.1:${port}/totally-unknown`);
    assert.equal(top.status, 404);
    const missingAsset = await fetch(`http://127.0.0.1:${port}/app/missing.js`);
    assert.equal(missingAsset.status, 404);
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(webroot, { recursive: true, force: true });
  }
});

// PER-144/PER-148: a genuinely-unknown route must render the export's styled
// 404.html — not the raw JSON `{"error":"not found"}` a user would otherwise
// see. PER-144 covered browser navigations (Accept: text/html); PER-148
// broadens it to bare/`*/*` clients (curl, a directly-typed stray URL) on
// extensionless routes too. Explicit JSON API clients and asset misses (paths
// with a file extension) still get the machine-readable JSON 404.
test("unknown route → styled 404.html, not raw JSON (PER-144/PER-148)", async () => {
  const tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-state-"));
  const stateFile = path.join(tmpStateDir, "state.json");
  await saveState({ pairing_token: newPairingToken() }, stateFile);

  const webroot = await fs.mkdtemp(path.join(os.tmpdir(), "scout-webroot-"));
  await fs.writeFile(path.join(webroot, "index.html"), "<!doctype html><title>root</title>");
  await fs.mkdir(path.join(webroot, "app"), { recursive: true });
  await fs.writeFile(path.join(webroot, "app", "index.html"), "<!doctype html><title>app</title>");
  await fs.writeFile(
    path.join(webroot, "404.html"),
    "<!doctype html><title>Page not found</title><a href=\"/\">home</a>",
  );

  const html = { accept: "text/html,application/xhtml+xml" };
  const { server, port } = await startServer(0, { stateFile, webroot });
  try {
    // Genuinely-unknown top-level path, browser navigation → 404 + styled page.
    const unknown = await fetch(`http://127.0.0.1:${port}/totally-unknown`, { headers: html });
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await unknown.text(), /Page not found/);

    // The PER-144 repro path itself stays caught by the SPA fallback (200 shell),
    // never reaching the 404 page.
    const appUnknown = await fetch(`http://127.0.0.1:${port}/app/nonexistent-xyz`, {
      headers: html,
    });
    assert.equal(appUnknown.status, 200);
    assert.match(await appUnknown.text(), /<title>app<\/title>/);

    // Explicit JSON API clients (application/json, no text/html) still get the
    // machine-readable JSON 404 — the /v0 contract is preserved.
    const json404 = await fetch(`http://127.0.0.1:${port}/totally-unknown`, {
      headers: { accept: "application/json" },
    });
    assert.equal(json404.status, 404);
    assert.equal((await json404.json()).error, "not found");

    // PER-148: a bare/`*/*` client (curl, a directly-typed stray URL with no
    // text/html and no application/json) on an extensionless route is treated
    // as a human landing on a stray URL → styled 404 page, never raw JSON.
    const bare = await fetch(`http://127.0.0.1:${port}/totally-bogus-zzz`, {
      headers: { accept: "*/*" },
    });
    assert.equal(bare.status, 404);
    assert.match(bare.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await bare.text(), /Page not found/);

    // PER-148: asset misses (path with a file extension) still get JSON 404 —
    // serving an HTML body for a missing script/style would be wrong.
    const asset404 = await fetch(`http://127.0.0.1:${port}/app/missing.js`, {
      headers: { accept: "*/*" },
    });
    assert.equal(asset404.status, 404);
    assert.equal((await asset404.json()).error, "not found");
  } finally {
    server.close();
    await fs.rm(tmpStateDir, { recursive: true, force: true });
    await fs.rm(webroot, { recursive: true, force: true });
  }
});
