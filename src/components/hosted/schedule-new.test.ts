// scheduleNew: the cadence a new topic from the chat gets.

import test from "node:test";
import assert from "node:assert/strict";
import type { HostedData } from "@/lib/hosted";
import { scheduleNew } from "./useHostedHome";

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
