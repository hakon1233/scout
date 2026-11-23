// scheduleNew: the cadence a new topic from the chat gets.

import test from "node:test";
import assert from "node:assert/strict";
import type { HostedData } from "@/lib/hosted";
import { resumeSlot, scheduleCreated, scheduleNew } from "./useHostedHome";

// Just what scheduleNew touches: the allowance, setCadence and runNow.
function stubData(daily: [number, number], weekly: [number, number]) {
  const set: [string, string][] = [];
  const ran: string[] = [];
  const data = {
    async home() {
      return {
        allowance: {
          daily: { used: daily[0], limit: daily[1] },
          weekly: { used: weekly[0], limit: weekly[1] },
        },
      };
    },
    async setCadence(id: string, cadence: string) {
      set.push([id, cadence]);
    },
    async runNow(id: string) {
      ran.push(id);
    },
  } as unknown as HostedData;
  return { data, set, ran };
}

test("a new topic gets the cadence the reader asked for", async () => {
  const { data, set, ran } = stubData([0, 2], [0, 3]);
  await scheduleNew(data, ["zigbee"], { zigbee: "weekly" });
  assert.deepEqual(set, [["zigbee", "weekly"]]);
  // The server queues its first brief; the day's Run now stays free.
  assert.deepEqual(ran, []);
});

test("an asked-for cadence with no free slot leaves the topic paused, never the other one", async () => {
  const { data, set } = stubData([0, 2], [3, 3]);
  await scheduleNew(data, ["zigbee"], { zigbee: "weekly" });
  assert.deepEqual(set, []);
});

test("without an asked-for cadence a topic takes the first free slot", async () => {
  const { data, set } = stubData([2, 2], [0, 3]);
  await scheduleNew(data, ["a"]);
  assert.deepEqual(set, [["a", "weekly"]]);
});

test("a confirmed new topic from the chat gets the cadence its card showed", async () => {
  const { data, set } = stubData([0, 1], [0, 6]);
  await scheduleCreated(data, {
    id: "t2",
    created_at: "2026-11-20T08:00:00Z",
    status: "ready",
    message: 'Create "Zigbee"',
    changes: [
      {
        interestId: "zigbee",
        op: "create",
        topic: "Zigbee",
        cadence: "weekly",
      },
    ],
  });
  assert.deepEqual(set, [["zigbee", "weekly"]]);
});

// resumeSlot: the cadence a paused topic gets back on Resume.

const allow = (
  daily: [number, number],
  weekly: [number, number],
  plan = "plus",
) => ({
  plan,
  daily: { used: daily[0], limit: daily[1] },
  weekly: { used: weekly[0], limit: weekly[1] },
  runsToday: { used: 0, limit: 3 },
});

test("Resume gives a paused topic its last cadence when that slot is free", () => {
  assert.deepEqual(resumeSlot(allow([0, 1], [0, 6]), "daily"), {
    cadence: "daily",
  });
  assert.deepEqual(resumeSlot(allow([0, 1], [0, 6]), "weekly"), {
    cadence: "weekly",
  });
});

test("Resume takes the other free slot when its last one is full", () => {
  assert.deepEqual(resumeSlot(allow([1, 1], [2, 6]), "daily"), {
    cadence: "weekly",
  });
  assert.deepEqual(resumeSlot(allow([0, 1], [6, 6]), "weekly"), {
    cadence: "daily",
  });
});

test("Resume with nothing remembered tries weekly first", () => {
  assert.deepEqual(resumeSlot(allow([0, 1], [0, 6]), null), {
    cadence: "weekly",
  });
});

test("Resume with no free slot says so plainly and sets nothing", () => {
  assert.deepEqual(resumeSlot(allow([0, 0], [3, 3], "free"), "weekly"), {
    message: "No free weekly slot. Pause another topic or upgrade.",
  });
  // Free has no daily slot, so a topic that was daily is told about weekly.
  assert.deepEqual(resumeSlot(allow([0, 0], [3, 3], "free"), "daily"), {
    message: "No free weekly slot. Pause another topic or upgrade.",
  });
  assert.deepEqual(resumeSlot(allow([1, 1], [6, 6]), "daily"), {
    message: "No free daily slot. Pause another topic first.",
  });
});
