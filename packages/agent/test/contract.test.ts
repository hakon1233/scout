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
import { saveState, loadState, newPairingToken, type Brief } from "../src/state.js";
import { startServer } from "../src/server.js";
import { MAX_INTERESTS } from "../src/limits.js";

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
    // releaseAll() only drains children ALREADY gated on stdin-finish. The
    // kick's 202 returns before the runner has written its state/doc files and
    // spawned the child, so a test that releases "right after" the kick is
    // racing that async setup — and since the PER-272 fsyncs it reliably
    // loses, leaving the child gated forever until the 4-minute session
    // timeout fails the run. Tests must await this before releaseAll().
    async waitForGatedChild(count = 1) {
      const deadline = Date.now() + 30_000;
      while (pending.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`no gated child after 30s (have ${pending.length}, want ${count})`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
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

test("GET /v0/briefs?limit=&offset= pages the ready-brief history newest-first (PER-219)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const { spawnFn } = makeSpawnRecorder({ autoClose: true });

  // Re-armable synthesis barrier so we can drive several sequential runs.
  let resolveDone: (b: Brief) => void = () => {};
  let doneP = new Promise<Brief>((r) => (resolveDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn,
    onSynthesisDone: (b) => resolveDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  async function runOnce(interests: string[]) {
    doneP = new Promise<Brief>((r) => (resolveDone = r));
    const kick = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      // Each sequential run intentionally replaces the prior topic list, so it
      // must carry the PER-240 wipe-guard token.
      body: JSON.stringify({ interests, confirm_replace: true }),
    });
    assert.equal(kick.status, 202);
    return doneP;
  }

  try {
    // Three sequential ready briefs → history holds all three, newest-first.
    const first = await runOnce(["ai safety"]);
    const second = await runOnce(["harness news"]);
    const third = await runOnce(["ai coding tools"]);

    // Page 1: the two most-recent, with the full total.
    const page1 = await fetch(
      `http://127.0.0.1:${port}/v0/briefs?limit=2&offset=0`,
      { headers: auth },
    );
    assert.equal(page1.status, 200);
    const p1 = (await page1.json()) as { briefs: Brief[]; total: number };
    assert.equal(p1.total, 3, "total reflects the whole history");
    assert.equal(p1.briefs.length, 2);
    assert.equal(p1.briefs[0].id, third.id, "newest-first");
    assert.equal(p1.briefs[1].id, second.id);

    // Page 2: the older remainder via offset.
    const page2 = await fetch(
      `http://127.0.0.1:${port}/v0/briefs?limit=2&offset=2`,
      { headers: auth },
    );
    const p2 = (await page2.json()) as { briefs: Brief[]; total: number };
    assert.equal(p2.briefs.length, 1, "last page is short");
    assert.equal(p2.briefs[0].id, first.id, "oldest is last");

    // Supplying only offset still uses the default page size (3). A missing
    // limit must not become Number(null) === 0 and collapse the page to 1 item.
    const offsetOnly = await fetch(
      `http://127.0.0.1:${port}/v0/briefs?offset=1`,
      { headers: auth },
    );
    const offsetBody = (await offsetOnly.json()) as { briefs: Brief[]; total: number };
    assert.equal(offsetOnly.status, 200);
    assert.equal(offsetBody.total, 3);
    assert.equal(offsetBody.briefs.length, 2, "offset-only request uses default limit");
    assert.equal(offsetBody.briefs[0].id, second.id);
    assert.equal(offsetBody.briefs[1].id, first.id);

    // Empty query values should behave like omitted values. URLSearchParams
    // returns "" for ?limit=&offset=; Number("") must not collapse either
    // default into a first-item-only page.
    const emptyParams = await fetch(
      `http://127.0.0.1:${port}/v0/briefs?limit=&offset=`,
      { headers: auth },
    );
    const emptyParamsBody = (await emptyParams.json()) as { briefs: Brief[]; total: number };
    assert.equal(emptyParams.status, 200);
    assert.equal(emptyParamsBody.total, 3);
    assert.equal(emptyParamsBody.briefs.length, 3, "empty limit uses the default page size");
    assert.equal(emptyParamsBody.briefs[0].id, third.id);
    assert.equal(emptyParamsBody.briefs[1].id, second.id);
    assert.equal(emptyParamsBody.briefs[2].id, first.id);

    // No params → the legacy single-slot poller contract is untouched.
    const legacy = await fetch(`http://127.0.0.1:${port}/v0/briefs`, {
      headers: auth,
    });
    const lg = (await legacy.json()) as { briefs: Brief[]; total?: number };
    assert.equal(lg.briefs.length, 1, "legacy returns only last_brief");
    assert.equal(lg.briefs[0].id, third.id);
    assert.equal(lg.total, undefined, "legacy response carries no total");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a second kick while a brief is in flight is rejected without clobbering the slot (PER-92)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  // autoClose:false → the first synthesis hangs, holding last_brief = pending.
  const { spawnFn, releaseAll, waitForGatedChild } = makeSpawnRecorder({
    autoClose: false,
  });

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

    // Wait for the first run's child to actually be spawned and gated, so
    // "in flight" is literal when the second kick lands — and so the
    // releaseAll() below is guaranteed to have a child to release.
    await waitForGatedChild();

    // A second kick lands before the first finishes → 409, echoing the
    // in-flight id. Crucially it does NOT overwrite the pending slot.
    const kick2 = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      // confirm_replace satisfies the PER-240 wipe guard so this kick reaches
      // the single-flight check — the rejection under test here.
      body: JSON.stringify({ interests: ["topic two"], confirm_replace: true }),
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

    // Per-interest sessions (C2/PER-171): one claude child per topic.
    assert.equal(recorder.calls.length, 2);

    // The token must appear in NONE of: argv, spawn options (incl. any env), or
    // the prompt piped to stdin — for EVERY spawned child, not just the first.
    for (const call of recorder.calls) {
      const argvBlob = JSON.stringify(call.args);
      const optsBlob = JSON.stringify(call.options ?? {});
      assert.ok(!argvBlob.includes(token), "token leaked into claude argv");
      assert.ok(!optsBlob.includes(token), "token leaked into claude spawn options/env");
      assert.ok(!call.stdin.includes(token), "token leaked into the claude prompt (stdin)");
    }

    // Each prompt is built from ONE interest's topic + doc, never the secret.
    // Sanity-check both topics show up (one per session) so we know we inspected
    // real prompts, not empty ones.
    const prompts = recorder.calls.map((c) => c.stdin);
    assert.ok(prompts.some((p) => /ai safety/.test(p)), "a session must cover 'ai safety'");
    assert.ok(prompts.some((p) => /markets/.test(p)), "a session must cover 'markets'");

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

test("PUT /v0/interests persists to state.json WITHOUT running a synthesis (PER-160)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  // autoClose:true would let a synthesis complete — but PUT must never spawn
  // claude at all. We assert `calls` stays empty to prove it's persist-only.
  const recorder = makeSpawnRecorder({ autoClose: true });
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn: recorder.spawnFn,
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth },
      // Includes a case-dupe ("AI safety"/"ai safety") to confirm PUT applies
      // the same clean/dedupe rules POST does (keep first casing, collapse).
      body: JSON.stringify({ interests: ["ai safety", "AI safety", "markets"] }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { interests: string[]; status: string };
    assert.equal(body.status, "saved");
    assert.deepEqual(body.interests, ["ai safety", "markets"]);

    // It persisted to state.json (the headless scheduler's source of truth) as
    // the rich {id, topic} model (PER-169); the topics round-trip losslessly.
    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.topic),
      ["ai safety", "markets"],
    );
    assert.ok(
      (state.interests ?? []).every((i) => typeof i.id === "string" && i.id),
      "every persisted interest has a stable id",
    );
    // …and left no brief slot behind — no run was kicked.
    assert.equal(state.last_brief, undefined);
    // The hard guarantee: claude was never spawned.
    assert.equal(recorder.calls.length, 0, "PUT must not spawn a synthesis");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("PUT /v0/interests rejects an empty/oversized interest list (PER-160)", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const recorder = makeSpawnRecorder({ autoClose: true });
  const { server, port } = await startServer(0, { stateFile, spawnFn: recorder.spawnFn });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const empty = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: [] }),
    });
    assert.equal(empty.status, 400);

    const tooMany = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        interests: Array.from(
          { length: MAX_INTERESTS + 1 },
          (_, i) => `topic ${i}`,
        ),
      }),
    });
    assert.equal(tooMany.status, 400);

    // Unauthenticated PUT is refused before any state write.
    const noAuth = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interests: ["x"] }),
    });
    assert.equal(noAuth.status, 401);

    const state = await loadState(stateFile);
    assert.equal(state.interests, undefined, "no rejected write should land");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("PUT /v0/interests rejects malformed interest entries without partial writes", async () => {
  const { tmp, stateFile, token } = await seededServer();
  const recorder = makeSpawnRecorder({ autoClose: true });
  const { server, port } = await startServer(0, { stateFile, spawnFn: recorder.spawnFn });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const malformed = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["ai safety", 42] }),
    });
    assert.equal(malformed.status, 400);
    const body = (await malformed.json()) as { error: string };
    assert.match(body.error, /interests must be strings/);

    const state = await loadState(stateFile);
    assert.equal(state.interests, undefined, "malformed payload must not partially persist");
    assert.equal(recorder.calls.length, 0, "PUT must not spawn a synthesis");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Wipe guard (PER-240). Both interest writes are replace-all; on 2026-06-11 a
// one-topic QA payload (`ephemeral:true` against a pre-PER-218 build) silently
// destroyed the founder's 5 saved interests. The guard: any write that would
// DROP a currently-saved topic is refused with 409 unless the caller passes an
// explicit `confirm_replace: true` (mirroring the PER-230 confirm-delete seam).
// Additive writes (same set / supersets) pass untouched, and ephemeral runs
// skip the guard because they persist nothing (PER-218).
// ---------------------------------------------------------------------------

async function seededServerWithInterests() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-wipeguard-"));
  const stateFile = path.join(tmp, "state.json");
  const token = newPairingToken();
  const saved = [
    { id: "i-ai", topic: "ai safety" },
    { id: "i-mk", topic: "markets" },
    { id: "i-cl", topic: "climate" },
  ];
  await saveState({ pairing_token: token, interests: saved }, stateFile);
  return { tmp, stateFile, token, saved };
}

test("POST /v0/interests refuses a subset payload that would drop saved interests (PER-240)", async () => {
  const { tmp, stateFile, token, saved } = await seededServerWithInterests();
  const recorder = makeSpawnRecorder({ autoClose: true });
  const { server, port } = await startServer(0, { stateFile, spawnFn: recorder.spawnFn });
  const auth = { authorization: `Bearer ${token}` };

  try {
    // The incident shape: a single throwaway topic replacing the whole set.
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["qa throwaway topic"] }),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; dropped: string[]; hint: string };
    assert.equal(body.error, "replace would drop saved interests");
    assert.deepEqual(body.dropped, ["ai safety", "markets", "climate"]);
    assert.ok(body.hint.includes("confirm_replace"), "hint names the confirm token");

    // Nothing persisted, no synthesis kicked.
    const state = await loadState(stateFile);
    assert.deepEqual(state.interests, saved, "saved interests must be untouched");
    assert.equal(state.last_brief, undefined, "no brief slot may be created");
    assert.equal(recorder.calls.length, 0, "claude must not be spawned");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/interests with confirm_replace:true performs the intentional replace (PER-240)", async () => {
  const { tmp, stateFile, token } = await seededServerWithInterests();
  const recorder = makeSpawnRecorder({ autoClose: true });
  let synthesisDone: (b: unknown) => void = () => {};
  const done = new Promise((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn: recorder.spawnFn,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["space"], confirm_replace: true }),
    });
    assert.equal(res.status, 202);

    // Wait out the kicked run so tmp-dir cleanup can't race its file writes.
    await done;
    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.topic),
      ["space"],
      "a confirmed replace persists the new list",
    );
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/interests passes a superset (additive) payload without confirmation (PER-240)", async () => {
  const { tmp, stateFile, token } = await seededServerWithInterests();
  const recorder = makeSpawnRecorder({ autoClose: true });
  let synthesisDone: (b: unknown) => void = () => {};
  const done = new Promise((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn: recorder.spawnFn,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    // Same three topics (one re-cased to prove case-insensitive matching) plus
    // one new — drops nothing, so the guard must not fire.
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["AI Safety", "markets", "climate", "space"] }),
    });
    assert.equal(res.status, 202);

    // Wait out the kicked run so tmp-dir cleanup can't race its file writes.
    await done;
    const state = await loadState(stateFile);
    assert.deepEqual(
      (state.interests ?? []).map((i) => i.topic),
      ["AI Safety", "markets", "climate", "space"],
    );
    // Id-preservation across the additive write keeps intent docs attached.
    assert.equal(state.interests?.find((i) => i.topic === "AI Safety")?.id, "i-ai");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /v0/interests {ephemeral:true} never alters persisted interests (PER-240 acceptance)", async () => {
  const { tmp, stateFile, token, saved } = await seededServerWithInterests();
  const recorder = makeSpawnRecorder({ autoClose: true });
  let synthesisDone: (b: unknown) => void = () => {};
  const done = new Promise((r) => (synthesisDone = r));
  const { server, port } = await startServer(0, {
    stateFile,
    spawnFn: recorder.spawnFn,
    onSynthesisDone: (b) => synthesisDone(b),
  });
  const auth = { authorization: `Bearer ${token}` };

  try {
    // A disjoint test topic, exactly like a QA fire — accepted (202, a brief is
    // produced) but the founder's saved set must be byte-identical afterwards.
    const res = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["qa throwaway topic"], ephemeral: true }),
    });
    assert.equal(res.status, 202);

    // Let the autoClose synthesis land fully before inspecting persisted state.
    await done;
    const state = await loadState(stateFile);
    assert.deepEqual(state.interests, saved, "ephemeral run must not touch saved interests");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("PUT /v0/interests applies the same wipe guard as POST (PER-240)", async () => {
  const { tmp, stateFile, token, saved } = await seededServerWithInterests();
  const recorder = makeSpawnRecorder({ autoClose: true });
  const { server, port } = await startServer(0, { stateFile, spawnFn: recorder.spawnFn });
  const auth = { authorization: `Bearer ${token}` };

  try {
    // Unconfirmed destructive PUT → 409, untouched state.
    const blocked = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["markets"] }),
    });
    assert.equal(blocked.status, 409);
    const blockedBody = (await blocked.json()) as { dropped: string[] };
    assert.deepEqual(blockedBody.dropped, ["ai safety", "climate"]);
    assert.deepEqual((await loadState(stateFile)).interests, saved);

    // Confirmed destructive PUT → 200, persisted, id of the kept topic survives.
    const ok = await fetch(`http://127.0.0.1:${port}/v0/interests`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ interests: ["markets"], confirm_replace: true }),
    });
    assert.equal(ok.status, 200);
    const state = await loadState(stateFile);
    assert.deepEqual((state.interests ?? []).map((i) => i.topic), ["markets"]);
    assert.equal(state.interests?.[0]?.id, "i-mk", "kept topic retains its id");
    assert.equal(recorder.calls.length, 0, "PUT never spawns a synthesis");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
