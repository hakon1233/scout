// Picks through their interface: a stub Claude client and an in-memory store.
// No network. Which readers are due, the 24-hour debounce, the spend caps and
// the owned, followed and dismissed filters live in the store (SQL); they are
// tested in supabase/tests/picks.test.sql. Here: what the module does with
// what the store hands it.

import test from "node:test";
import assert from "node:assert/strict";
import type { Pick, PicksInput } from "@scout/core";
import { recordedClient, type MessagesResponse } from "@scout/research";
import {
  PICKS_MODEL,
  createPicks,
  type PicksJob,
  type PicksStore,
} from "../src/index.ts";

function answer(json: unknown, stop = "end_turn"): MessagesResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(json) }],
    stop_reason: stop,
    usage: { input_tokens: 4000, output_tokens: 300 },
  };
}

const input: PicksInput = {
  profile: { location: "Bergen", likedTags: ["outdoors"] },
  reading: [{ title: "Ski touring", tags: ["outdoors"] }],
  marks: [],
  candidates: [
    { id: "i-fjord", title: "Fjord kayaking", tags: ["outdoors"], about: "" },
    { id: "i-chips", title: "AI chips", tags: ["ai"], about: "" },
  ],
};

function memoryStore(jobs: PicksJob[]) {
  const finished: {
    userId: string;
    picks: Pick[] | null;
    costUsd: number;
    error: string | null;
  }[] = [];
  const limits: number[] = [];
  const store: PicksStore = {
    async claim(limit) {
      limits.push(limit);
      return jobs.splice(0, limit);
    },
    async finish(job, picks, costUsd, error) {
      finished.push({ userId: job.userId, picks, costUsd, error });
    },
  };
  return { store, finished, limits };
}

function job(userId: string, over: Partial<PicksInput> = {}): PicksJob {
  return { userId, runId: 1, kind: "weekly", input: { ...input, ...over } };
}

test("picks are stored under candidate ids, with their cost", async () => {
  const claude = recordedClient([
    answer({
      picks: [
        { topic: "c1", reason: "You follow ski touring." },
        { topic: "c7", reason: "Not a candidate." },
      ],
    }),
  ]);
  const { store, finished } = memoryStore([job("pia")]);
  const result = await createPicks({ claude, store }).refresh(3);
  assert.equal(result.claimed, 1);
  assert.equal(result.stored, 1);
  assert.equal(claude.requests[0].model, PICKS_MODEL);
  assert.deepEqual(finished[0].picks, [
    { interestId: "i-fjord", reason: "You follow ski touring." },
  ]);
  assert.ok(finished[0].costUsd > 0 && finished[0].costUsd < 0.002);
  const prompt = JSON.stringify(claude.requests[0].messages);
  assert.match(prompt, /Fjord kayaking/);
  assert.doesNotMatch(prompt, /i-fjord/);
});

test("a reader with no candidates is stored empty without a call", async () => {
  const claude = recordedClient([]);
  const { store, finished } = memoryStore([job("pia", { candidates: [] })]);
  const result = await createPicks({ claude, store }).refresh(3);
  assert.equal(claude.requests.length, 0);
  assert.deepEqual(finished, [
    { userId: "pia", picks: [], costUsd: 0, error: null },
  ]);
  assert.equal(result.costUsd, 0);
});

test("nobody due (debounced or over the cap): no call", async () => {
  const claude = recordedClient([]);
  const { store, finished } = memoryStore([]);
  const result = await createPicks({ claude, store }).refresh(3);
  assert.equal(result.claimed, 0);
  assert.equal(claude.requests.length, 0);
  assert.equal(finished.length, 0);
});

test("a failed call keeps the cached picks; a refusal stores none", async () => {
  // recordedClient throws once it runs out of answers: the second reader fails.
  const claude = recordedClient([answer({}, "refusal")]);
  const { store, finished } = memoryStore([job("pia"), job("una")]);
  const result = await createPicks({ claude, store }).refresh(3);
  assert.equal(result.stored, 1);
  assert.equal(result.failed, 1);
  const byUser = Object.fromEntries(finished.map((f) => [f.userId, f]));
  const [refused, failed] = byUser.pia.picks
    ? [byUser.pia, byUser.una]
    : [byUser.una, byUser.pia];
  assert.deepEqual(refused.picks, []);
  assert.equal(failed.picks, null);
  assert.equal(failed.costUsd, 0);
  assert.ok(failed.error);
});

test("refresh claims at most the batch, and nothing for a zero batch", async () => {
  const claude = recordedClient([]);
  const { store, limits } = memoryStore([]);
  await createPicks({ claude, store }).refresh(0);
  assert.deepEqual(limits, []);
  await createPicks({ claude, store }).refresh(2);
  assert.deepEqual(limits, [2]);
});
