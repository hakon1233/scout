// Stale-pending reclaim contract for the run loop (PER-181).
//
// Background: within a live process, `runInFlight` is true for the whole
// lifetime of a real run, so a second request is correctly refused. The ONLY
// way to observe a persisted `pending` brief while `runInFlight` is false is a
// process that DIED mid-run (launchd KeepAlive restart, sleep, OOM). Before this
// fix that bricked the companion permanently: every later run saw the orphaned
// `pending` and returned `in_flight` forever, with no live process to ever
// finish it. The reclaim guard lets a sufficiently-old pending be overwritten by
// a fresh run, while a recent pending (a genuinely live run) is still refused.
//
// Hermetic: a stub `claude` returns a topic section; no real binary, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import {
  loadState,
  saveState,
  type Brief,
  type Interest,
} from "../src/state.js";
import { startRun, summarizeSessionFailures } from "../src/runner.js";
import { writeInterestDoc, defaultInterestDoc } from "../src/docs.js";

// PER-259 item 1: a wholesale-failed run must report an HONEST reason so the
// founder learns WHY (a usage limit reads very differently from a crashed CLI).
// The classifier is pure — pin the mapping from research.ts's reject messages.
test("summarizeSessionFailures distils per-session errors into an honest reason (PER-259)", () => {
  assert.match(
    summarizeSessionFailures([
      "claude exited 1: Claude usage limit reached|resets at 3pm",
    ]),
    /usage\/session limit/i,
  );
  assert.match(
    summarizeSessionFailures([
      'claude session for "ai" timed out after 240000ms',
    ]),
    /timed out/i,
  );
  assert.match(
    summarizeSessionFailures([
      "failed to spawn 'claude' — is the Claude Code CLI installed and on PATH? (ENOENT)",
    ]),
    /Claude CLI/i,
  );
  assert.match(
    summarizeSessionFailures(["claude returned empty output"]),
    /no usable content/i,
  );
  // Unknown shape → surface the first real message rather than a vague blank.
  assert.equal(summarizeSessionFailures(["boom"]), "boom");
  assert.equal(summarizeSessionFailures([]), "unknown error");
  // A usage-limit anywhere in the set wins over a generic sibling failure.
  assert.match(
    summarizeSessionFailures(["boom", "claude exited 1: usage limit reached"]),
    /usage\/session limit/i,
  );
});

const INTERESTS: Interest[] = [{ id: "int_x", topic: "ai" }];

// A fast per-interest stub: emits the requested topic's section, then closes 0.
function makeFastSpawn() {
  const spawnFn = ((_bin: string, _args: readonly string[], _opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let stdin = "";
    child.stdin = new Writable({
      write(c, _e, cb) {
        stdin += c.toString();
        cb();
      },
    });
    child.stdin.on("finish", () =>
      setImmediate(() => {
        const topic = /single topic: "([^"]+)"/.exec(stdin)?.[1] ?? "ai";
        child.stdout.emit(
          "data",
          Buffer.from(
            `## ${topic}\n- a thing.\n  [src](https://example.com/a)\n`,
          ),
        );
        child.emit("close", 0);
      }),
    );
    return child;
  }) as unknown as typeof spawn;
  return { spawnFn };
}

async function tmpStateFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-runner-"));
  return path.join(dir, "state.json");
}

// Run startRun and wait for synthesis to land, so the module-level runInFlight
// guard resets before the next test (the singleton is shared across this file).
async function runToCompletion(
  interests: Interest[],
  stateFile: string,
  spawnFn: typeof spawn,
) {
  const done = new Promise<Brief>((resolve) => {
    void startRun(interests, {
      stateFile,
      spawnFn,
      onSynthesisDone: (b) => resolve(b),
    });
  });
  return done;
}

test("PER-181: a STALE persisted pending is reclaimed by a new run", async () => {
  const stateFile = await tmpStateFile();
  // A pending brief from a process that died 40 min ago (> 30 min grace window).
  const stale: Brief = {
    id: "dead-run",
    generated_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    status: "pending",
  };
  await saveState({ interests: INTERESTS, last_brief: stale }, stateFile);

  const { spawnFn } = makeFastSpawn();
  const landed = await runToCompletion(INTERESTS, stateFile, spawnFn);

  // The reclaimed run produced a fresh, NON-pending brief with a new id.
  assert.notEqual(landed.id, "dead-run", "reclaim must mint a fresh brief id");
  assert.equal(landed.status, "ready");
  const persisted = await loadState(stateFile);
  assert.equal(persisted.last_brief?.status, "ready");
  assert.match(persisted.last_brief?.summary_md ?? "", /## ai/);
});

test("PER-187: the brief snapshots each topic's intent doc into `bases`", async () => {
  const stateFile = await tmpStateFile();
  const interestsDir = path.join(path.dirname(stateFile), "interests");
  // Two interests: one with a hand-authored doc, one with NO doc (so the run
  // backfills the default via ensureInterestDoc). The snapshot must capture the
  // EXACT bytes used for each — the custom doc verbatim, and the default for the
  // docless one — so the brief can show the real basis for every section.
  const interests: Interest[] = [
    { id: "int_seeded", topic: "ai" },
    { id: "int_bare", topic: "climate" },
  ];
  const customDoc =
    "# ai\n\nOnly frontier-model releases. Ignore funding rounds.\n";
  await writeInterestDoc("int_seeded", customDoc, interestsDir);

  const { spawnFn } = makeFastSpawn();
  const landed = await runToCompletion(interests, stateFile, spawnFn);

  assert.equal(landed.status, "ready");
  const bases = landed.bases ?? [];
  const seeded = bases.find((b) => b.topic === "ai");
  const bare = bases.find((b) => b.topic === "climate");
  assert.ok(seeded, "a basis snapshot exists for the seeded topic");
  assert.equal(seeded!.doc, customDoc, "custom doc is snapshotted verbatim");
  assert.ok(bare, "a basis snapshot exists for the docless topic");
  assert.equal(
    bare!.doc,
    defaultInterestDoc("climate"),
    "docless topic snapshots the backfilled default",
  );
  // The snapshot survives the round-trip to disk, so a reconnecting poller reads it.
  const persisted = await loadState(stateFile);
  assert.equal(persisted.last_brief?.bases?.length, 2);
});

test("PER-181: a RECENT persisted pending is still refused (live run)", async () => {
  const stateFile = await tmpStateFile();
  const fresh: Brief = {
    id: "live-run",
    generated_at: new Date().toISOString(), // just started — a real run in flight.
    status: "pending",
  };
  await saveState({ interests: INTERESTS, last_brief: fresh }, stateFile);

  const { spawnFn } = makeFastSpawn();
  const outcome = await startRun(INTERESTS, { stateFile, spawnFn });
  assert.equal(outcome.started, false);
  if (!outcome.started) {
    assert.equal(outcome.reason, "in_flight");
    assert.equal(outcome.briefId, "live-run");
  }
  // Nothing was overwritten.
  const persisted = await loadState(stateFile);
  assert.equal(persisted.last_brief?.id, "live-run");
  assert.equal(persisted.last_brief?.status, "pending");
});

test("CAR-174: a failed startup save resets runInFlight so the slot stays reclaimable", async () => {
  // `runInFlight` is claimed synchronously (before the first await) so a second
  // startRun can't race in and double-start. But the persisting save that
  // follows can throw (disk full, ENOTDIR). Before this fix that throw left
  // runInFlight stuck true for the life of the process, wedging EVERY later run
  // with `in_flight` and making isStalePending refuse to reclaim the slot.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-runner-fail-"));
  // A regular file where atomicWriteFile expects to mkdir a directory → the
  // recursive mkdir of dirname fails with ENOTDIR and saveState rejects.
  const blocker = path.join(dir, "blocker");
  await fs.writeFile(blocker, "x");
  const badStateFile = path.join(blocker, "state.json");

  const { spawnFn } = makeFastSpawn();
  await assert.rejects(
    () => startRun(INTERESTS, { stateFile: badStateFile, spawnFn }),
    "startRun should surface the save failure to the caller",
  );

  // The slot must NOT be wedged: a fresh run against a writable state file is
  // accepted and completes, rather than being refused with `in_flight`.
  const goodStateFile = path.join(dir, "state.json");
  const landed = await runToCompletion(INTERESTS, goodStateFile, spawnFn);
  assert.equal(
    landed.status,
    "ready",
    "the slot was reclaimable after the failure",
  );
});
