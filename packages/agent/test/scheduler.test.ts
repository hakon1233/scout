// In-process scheduler tests (PER-151). All hermetic: the `claude` shell-out is
// replaced with an in-process spawn stub, and time is injected, so these cost
// zero quota, never touch the network, and don't wait on wall-clock.
//
// Covered:
//   - nextFireAt rollover (today vs tomorrow) + normalizeTimeOfDay validation.
//   - A scheduled fire actually produces a brief through the shared run path,
//     and records last_run_status=success + a fresh next_run_at (the PER-139
//     "real, not dead" requirement: a configured schedule produces briefs).
//   - Concurrency safety: a fire while a run is already in flight is SKIPPED
//     (records last_run_status=skipped), never launching an overlapping run.
//   - A fire with no stored interests is skipped, not a crash.
//   - GET/PUT /v0/schedule contract the Settings UI (PER-152) consumes.

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
  newPairingToken,
  normalizeTimeOfDay,
  defaultSchedule,
  type Brief,
  type State,
} from "../src/state.js";
import { Scheduler, nextFireAt } from "../src/scheduler.js";
import { startServer } from "../src/server.js";

const CANNED_BRIEF =
  "# Your brief\n\n## ai safety\n- A lab shipped alignment work.\n  [example.com — Update](https://example.com/a)\n";

// Spawn stub: with autoClose it emits the canned brief and exits 0 once stdin
// ends; otherwise it hangs (held "in flight") until releaseAll() is called.
function makeSpawnRecorder(opts: { autoClose: boolean }) {
  const calls: Array<{ stdin: string }> = [];
  const pending: Array<() => void> = [];
  const spawnFn = ((_bin: string, _args: readonly string[], _options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let stdinData = "";
    const record = { stdin: "" };
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

async function tmpState(seed: State): Promise<{ tmp: string; stateFile: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scout-sched-"));
  const stateFile = path.join(tmp, "state.json");
  await saveState(seed, stateFile);
  return { tmp, stateFile };
}

test("nextFireAt rolls to tomorrow when today's time already passed", () => {
  // 2026-06-01 08:30 local; schedule 07:00 → tomorrow 07:00.
  const from = new Date(2026, 5, 1, 8, 30, 0, 0);
  const next = nextFireAt("07:00", from)!;
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 5);
  assert.equal(next.getDate(), 2);
  assert.equal(next.getHours(), 7);
  assert.equal(next.getMinutes(), 0);
});

test("nextFireAt uses today when the time is still ahead", () => {
  const from = new Date(2026, 5, 1, 6, 0, 0, 0);
  const next = nextFireAt("07:00", from)!;
  assert.equal(next.getDate(), 1);
  assert.equal(next.getHours(), 7);
});

test("normalizeTimeOfDay validates + zero-pads, rejects garbage", () => {
  assert.equal(normalizeTimeOfDay("7:5"), null); // minutes must be 2 digits
  assert.equal(normalizeTimeOfDay("7:05"), "07:05");
  assert.equal(normalizeTimeOfDay("23:59"), "23:59");
  assert.equal(normalizeTimeOfDay("24:00"), null);
  assert.equal(normalizeTimeOfDay("07:60"), null);
  assert.equal(normalizeTimeOfDay("nope"), null);
  assert.equal(normalizeTimeOfDay(700), null);
});

test("a scheduled fire produces a brief and records success + next_run_at (PER-139 real-not-dead)", async () => {
  const { tmp, stateFile } = await tmpState({
    pairing_token: newPairingToken(),
    interests: [{ id: "int_aisafety", topic: "ai safety" }],
    schedule: { enabled: true, time_of_day: "07:00" },
  });
  const { spawnFn } = makeSpawnRecorder({ autoClose: true });

  let done: (b: Brief) => void;
  const doneP = new Promise<Brief>((r) => (done = r));
  // Fire "happens" at 2026-06-01 07:00 local.
  const now = () => new Date(2026, 5, 1, 7, 0, 0, 0);
  const scheduler = new Scheduler(
    { stateFile, spawnFn, onSynthesisDone: (b) => done(b) },
    now,
  );

  try {
    await scheduler.fire();
    const brief = await doneP;
    assert.equal(brief.status, "ready");

    const state = await loadState(stateFile);
    assert.equal(state.last_brief?.status, "ready", "scheduled run produced a real brief");
    assert.match(state.last_brief?.summary_md ?? "", /## ai safety/);
    assert.equal(state.schedule?.last_run_status, "success");
    assert.ok(state.schedule?.last_run_at, "last_run_at recorded");
    // next_run_at must be re-armed for tomorrow (07:00 already passed at fire).
    const next = new Date(state.schedule!.next_run_at!);
    assert.equal(next.getDate(), 2, "next fire rolled to tomorrow");
    assert.equal(next.getHours(), 7);
  } finally {
    scheduler.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a fire while a run is in flight is skipped, never overlapping (concurrency safety)", async () => {
  const { tmp, stateFile } = await tmpState({
    pairing_token: newPairingToken(),
    interests: [{ id: "int_aisafety", topic: "ai safety" }],
    schedule: { enabled: true, time_of_day: "07:00" },
    // A run is already pending (e.g. an on-demand "Run now" still synthesizing).
    last_brief: { id: "in-flight-id", generated_at: new Date().toISOString(), status: "pending" },
  });
  const recorder = makeSpawnRecorder({ autoClose: true });
  const now = () => new Date(2026, 5, 1, 7, 0, 0, 0);
  const scheduler = new Scheduler({ stateFile, spawnFn: recorder.spawnFn }, now);

  try {
    await scheduler.fire();
    // No claude child spawned — the fire was skipped, not overlapped.
    assert.equal(recorder.calls.length, 0, "no synthesis spawned while a run was in flight");
    const state = await loadState(stateFile);
    // The pending slot is untouched, and the skip is recorded (legible, not silent).
    assert.equal(state.last_brief?.id, "in-flight-id");
    assert.equal(state.last_brief?.status, "pending");
    assert.equal(state.schedule?.last_run_status, "skipped");
    assert.match(state.schedule?.last_run_note ?? "", /in progress/);
    assert.ok(state.schedule?.next_run_at, "still re-armed for next fire");
  } finally {
    scheduler.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a fire with no stored interests is skipped, not a crash", async () => {
  const { tmp, stateFile } = await tmpState({
    pairing_token: newPairingToken(),
    schedule: { enabled: true, time_of_day: "07:00" },
  });
  const recorder = makeSpawnRecorder({ autoClose: true });
  const now = () => new Date(2026, 5, 1, 7, 0, 0, 0);
  const scheduler = new Scheduler({ stateFile, spawnFn: recorder.spawnFn }, now);
  try {
    await scheduler.fire();
    assert.equal(recorder.calls.length, 0);
    const state = await loadState(stateFile);
    assert.equal(state.schedule?.last_run_status, "skipped");
    assert.match(state.schedule?.last_run_note ?? "", /no interests/);
  } finally {
    scheduler.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("disabled schedule arms no timer and clears next_run_at", async () => {
  const { tmp, stateFile } = await tmpState({
    pairing_token: newPairingToken(),
    schedule: { enabled: false, time_of_day: "07:00", next_run_at: "2026-06-02T07:00:00.000Z" },
  });
  const scheduler = new Scheduler({ stateFile });
  try {
    await scheduler.start();
    const state = await loadState(stateFile);
    assert.equal(state.schedule?.next_run_at, undefined, "next_run_at cleared when disabled");
  } finally {
    scheduler.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /v0/schedule returns the Settings-UI contract incl. reboot_durable:false", async () => {
  const { tmp, stateFile } = await tmpState({
    pairing_token: newPairingToken(),
    schedule: defaultSchedule(),
  });
  // Pin durability detection to a non-existent plist so this is deterministic
  // regardless of whether the host machine has the LaunchAgent installed.
  const prevPlist = process.env.SCOUT_LAUNCH_AGENT_PLIST;
  process.env.SCOUT_LAUNCH_AGENT_PLIST = path.join(tmp, "no-such.plist");
  const token = (await loadState(stateFile)).pairing_token!;
  const { server, port } = await startServer(0, { stateFile });
  const auth = { authorization: `Bearer ${token}` };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v0/schedule`, { headers: auth });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.enabled, true);
    assert.equal(body.time_of_day, "07:00");
    assert.equal(body.reboot_durable, false);
    assert.equal(body.last_run_at, null);
    assert.equal(body.next_run_at, null);

    // unauth → 401
    const un = await fetch(`http://127.0.0.1:${port}/v0/schedule`);
    assert.equal(un.status, 401);

    // Once a LaunchAgent plist is present, reboot_durable flips to true with no
    // restart or config write (PER-153) — the view reads the live filesystem.
    await fs.writeFile(process.env.SCOUT_LAUNCH_AGENT_PLIST!, "<plist/>");
    const durable = await fetch(`http://127.0.0.1:${port}/v0/schedule`, { headers: auth });
    const durableBody = (await durable.json()) as Record<string, unknown>;
    assert.equal(durableBody.reboot_durable, true);
  } finally {
    if (prevPlist === undefined) delete process.env.SCOUT_LAUNCH_AGENT_PLIST;
    else process.env.SCOUT_LAUNCH_AGENT_PLIST = prevPlist;
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("PUT /v0/schedule validates, persists, and re-arms the scheduler", async () => {
  const { tmp, stateFile } = await tmpState({
    pairing_token: newPairingToken(),
    schedule: defaultSchedule(),
  });
  const token = (await loadState(stateFile)).pairing_token!;
  const scheduler = new Scheduler({ stateFile }, () => new Date(2026, 5, 1, 8, 0, 0, 0));
  const { server, port } = await startServer(0, {
    stateFile,
    onScheduleChanged: () => scheduler.reschedule(),
  });
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    // Bad time → 400, nothing persisted.
    const bad = await fetch(`http://127.0.0.1:${port}/v0/schedule`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ time_of_day: "99:99" }),
    });
    assert.equal(bad.status, 400);

    // Valid change → 200, persisted, and next_run_at recomputed by the re-arm.
    const ok = await fetch(`http://127.0.0.1:${port}/v0/schedule`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ enabled: true, time_of_day: "9:30" }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as Record<string, unknown>;
    assert.equal(body.time_of_day, "09:30", "zero-padded + persisted");
    assert.equal(body.enabled, true);
    // Re-arm ran (now=08:00 < 09:30) → next fire today at 09:30.
    const next = new Date(body.next_run_at as string);
    assert.equal(next.getHours(), 9);
    assert.equal(next.getMinutes(), 30);
    assert.equal(next.getDate(), 1);

    const persisted = await loadState(stateFile);
    assert.equal(persisted.schedule?.time_of_day, "09:30");
  } finally {
    scheduler.stop();
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
