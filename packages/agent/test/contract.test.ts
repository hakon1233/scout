// Contract + regression tests that the loopback round-trip in
// loopback.test.ts doesn't pin directly:
//
//   - PER-106: GET /v0/briefs returns the exact render contract the web app
//     parser (src/lib/companion.ts adaptBrief) consumes — id/generated_at/
//     status/summary_md, with citations the app can turn into articles.
//   - PER-92:  a second kick while a brief is in flight is rejected (409) and
//     the in-flight slot is NOT clobbered — last-writer-wins stays the *first*
//     writer until it lands.
//   - PER-108: the pairing token is never forwarded to the `claude` child
//     (argv / spawn options / stdin) and never written to stdout/stderr; the
//     companion needs no Anthropic API key to synthesize (it relies on the
//     local claude CLI's own auth), so a blank-key setup still works.
//
// All hermetic: the `claude` shell-out is replaced with an in-process spawn
// stub, so these cost zero quota and never touch the network.
//
// Run with: pnpm --filter @scout/agent test

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import { saveState, newPairingToken, type Brief } from "../src/state.js";
import { startServer } from "../src/server.js";

const CANNED_BRIEF =
  "# Your brief\n\n## ai safety\n- A model lab published new alignment work.\n  [example.com — Alignment update](https://example.com/a)\n";

// A spawn() stand-in that records every invocation (argv, options, the prompt
// piped to stdin) and lets the test control when each child "closes". With
// `autoClose: true` the child emits the canned brief and exits 0 as soon as
// stdin ends; otherwise the child hangs until `releaseAll()` is called, which
// is how we hold a synthesis "in flight" to exercise the PER-92 race window.
function makeSpawnRecorder(opts: { autoClose: boolean }) {
  const calls: Array<{ bin: string; args: readonly string[]; options: unknown; stdin: string }> = [];
  const pending: Array<() => void> = [];

  const spawnFn = ((bin: string, args: readonly string[], options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    // Leave pid undefined so research.ts skips the os.setPriority() hedge —
    // we don't want the test poking a real (or bogus) process's niceness.
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    let stdinData = "";
    const record = { bin, args, options, stdin: "" };
    calls.push(record);

    const finish = () => {
      record.stdin = stdinData;
      child.stdout.emit("data", Buffer.from(CANNED_BRIEF));
      child.emit("close", 0);
    };

    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        stdinData += chunk.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => {
      if (opts.autoClose) setImmediate(finish);
      else pending.push(finish);
    });

    return child;
  }) as unknown as typeof spawn;

  return {
    calls,
    spawnFn,
    releaseAll() {
      while (pending.length) pending.shift()!();
    },
  };
}

async function seededServer() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-contract-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  await saveState({ pairing_token: token }, stateFile);
  return { tmp, stateFile, token };
}

test("GET /v0/briefs returns the render contract the web app parses (PER-106)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const { spawnFn } = makeSpawnRecorder({ autoClose: true });

  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["ai safety"] }),
    });
    assert.equal(kick.status, 202);
    await doneP;

    const res = await fetch(`http://127.0.0.1:${port}/v0/briefs`, { headers: auth });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { briefs: Brief[] };

    // Top-level envelope the poller expects: { briefs: [...] }.
    assert.ok(Array.isArray(body.briefs), "response must carry a `briefs` array");
    assert.equal(body.briefs.length, 1);
    const brief = body.briefs[0];

    // adaptBrief() in src/lib/companion.ts reads exactly these fields. Pin them.
    assert.equal(typeof brief.id, "string");
    assert.equal(typeof brief.generated_at, "string");
    assert.ok(!Number.isNaN(Date.parse(brief.generated_at)), "generated_at is ISO");
    assert.equal(brief.status, "ready");
    assert.equal(typeof brief.summary_md, "string");

    // The app turns the markdown into articles by scanning `## topic` headings
    // and `[domain — Title](url)` citations. If either format drifts, the
    // Sources panel + interest chips silently empty — so lock both here.
    const md = brief.summary_md ?? "";
    assert.match(md, /^##\s+.+/m, "summary_md must contain a `## topic` heading");
    assert.match(
      md,
      /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/,
      "summary_md must contain a [label](url) citation the app can parse",
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a second kick while a brief is in flight is rejected without clobbering the slot (PER-92)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  // autoClose:false → the first synthesis hangs, holding last_brief = pending.
  const { spawnFn, releaseAll } = makeSpawnRecorder({ autoClose: false });

  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const kick1 = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["topic one"] }),
    });
    assert.equal(kick1.status, 202);
    const firstId = ((await kick1.json()) as { brief_id: string }).brief_id;

    // The slot is now pending with the first id.
    const mid = await fetch(`http://127.0.0.1:${port}/v0/briefs`, { headers: auth });
    const midBriefs = ((await mid.json()) as { briefs: Brief[] }).briefs;
    assert.equal(midBriefs[0]?.status, "pending");
    assert.equal(midBriefs[0]?.id, firstId);

    // A second kick lands before the first finishes → 409, echoing the
    // in-flight id. Crucially it does NOT overwrite the pending slot.
    const kick2 = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["topic two"] }),
    });
    assert.equal(kick2.status, 409);
    const body2 = (await kick2.json()) as { error: string; brief_id: string };
    assert.equal(body2.brief_id, firstId);
    assert.match(body2.error, /in progress/);

    // Let the first synthesis finish — it must land under the original id,
    // proving the second kick never clobbered it.
    releaseAll();
    const landed = await doneP;
    assert.equal(landed.id, firstId);
    assert.equal(landed.status, "ready");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("the pairing token is never forwarded to claude or logged, and no API key is required (PER-108)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const recorder = makeSpawnRecorder({ autoClose: true });

  let synthesisDone: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (synthesisDone = r));

  // Capture everything the process writes while a request is in flight: the
  // token is high-entropy and opaque, so its absence from all logs is a sharp
  // guard against a future "log the request" regression leaking it.
  const logged: string[] = [];
  const orig = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  for (const k of Object.keys(orig) as Array<keyof typeof orig>) {
    console[k] = (...a: unknown[]) => logged.push(a.map(String).join(" "));
  }

  // Make sure a blank-key environment is what we test: the companion must work
  // with no Anthropic API key in the env (PER-108 — keys are optional; auth is
  // delegated to the local claude CLI's own credentials).
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn: recorder.spawnFn,
    onSynthesisDone: (b) => synthesisDone(b),
  });

  try {
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ interests: ["ai safety", "markets"] }),
    });
    assert.equal(kick.status, 202);
    const brief = await doneP;
    assert.equal(brief.status, "ready", "synthesis succeeds with no API key configured");

    // Exactly one claude child was spawned.
    assert.equal(recorder.calls.length, 1);
    const call = recorder.calls[0];

    // The token must appear in NONE of: argv, spawn options (incl. any env),
    // or the prompt piped to stdin.
    const argvBlob = JSON.stringify(call.args);
    const optsBlob = JSON.stringify(call.options ?? {});
    assert.ok(!argvBlob.includes(token), "token leaked into claude argv");
    assert.ok(!optsBlob.includes(token), "token leaked into claude spawn options/env");
    assert.ok(!call.stdin.includes(token), "token leaked into the claude prompt (stdin)");

    // The prompt is built from interests only — it carries the topics, never
    // the secret. Sanity-check the topics are there so we know we inspected a
    // real prompt, not an empty one.
    assert.match(call.stdin, /ai safety/);
    assert.match(call.stdin, /markets/);

    // Nothing logged during the whole exchange may contain the token.
    const allLogs = logged.join("\n");
    assert.ok(!allLogs.includes(token), "token leaked into stdout/stderr logs");
  } finally {
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = orig[k];
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
