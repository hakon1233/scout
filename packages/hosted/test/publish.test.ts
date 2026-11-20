// The publish check through its interface: a stub Claude client and an
// in-memory store. No network.

import test from "node:test";
import assert from "node:assert/strict";
import type { PublishVerdict } from "@scout/core";
import { recordedClient, type MessagesResponse } from "@scout/research";
import {
  PUBLISH_MODEL,
  PublishCheckFailed,
  createPublish,
  type PublishStart,
  type PublishStore,
} from "../src/index.ts";

function answer(json: unknown, stop = "end_turn"): MessagesResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(json) }],
    stop_reason: stop,
    usage: { input_tokens: 1000, output_tokens: 50 },
  } as MessagesResponse;
}

function memoryStore(topic: Partial<PublishStart> = {}) {
  const finished: { verdict: PublishVerdict; costUsd: number }[] = [];
  const store: PublishStore = {
    async start(userId, interestId) {
      if (userId !== "u1" || interestId !== "i1") throw new Error("not yours");
      return {
        checkId: "7",
        title: "Fjord kayaking",
        doc: "Trips and gear.",
        displayName: "Kari",
        maxDocChars: 4000,
        ...topic,
      };
    },
    async finish(_userId, _checkId, verdict, costUsd) {
      finished.push({ verdict, costUsd });
      return verdict.approved ? "slug123" : null;
    },
  };
  return { store, finished };
}

test("an approve makes the topic public with the model's tags", async () => {
  const claude = recordedClient([
    answer({
      verdict: "approve",
      reason: "",
      tags: ["travel", "Kayaking", "fjords"],
    }),
  ]);
  const { store, finished } = memoryStore();
  const result = await createPublish({ claude, store }).publish("u1", "i1");
  assert.deepEqual(result, {
    status: "public",
    slug: "slug123",
    tags: ["travel", "kayaking"],
  });
  assert.equal(claude.requests[0].model, PUBLISH_MODEL);
  assert.equal(finished.length, 1);
  assert.ok(finished[0].costUsd > 0);
  const prompt = JSON.stringify(claude.requests[0].messages);
  assert.match(prompt, /Fjord kayaking/);
  assert.match(prompt, /Kari/);
});

test("a refuse returns the model's reason and records it", async () => {
  const claude = recordedClient([
    answer({ verdict: "refuse", reason: "Names a private person.", tags: [] }),
  ]);
  const { store, finished } = memoryStore();
  const result = await createPublish({ claude, store }).publish("u1", "i1");
  assert.deepEqual(result, {
    status: "refused",
    reason: "Names a private person.",
  });
  assert.equal(finished[0].verdict.approved, false);
});

test("the plain checks refuse without a model call", async () => {
  const claude = recordedClient([]);
  const { store } = memoryStore({ title: "x".repeat(81) });
  const result = await createPublish({ claude, store }).publish("u1", "i1");
  assert.equal(result.status, "refused");
  assert.equal(claude.requests.length, 0);
});

test("a cut-off or refused answer fails closed", async () => {
  for (const stop of ["max_tokens", "refusal"]) {
    const claude = recordedClient([
      answer({ verdict: "approve", reason: "", tags: ["ai"] }, stop),
    ]);
    const { store } = memoryStore();
    const result = await createPublish({ claude, store }).publish("u1", "i1");
    assert.equal(result.status, "refused", stop);
  }
});

test("a check that cannot run is recorded as refused and thrown", async () => {
  const claude = recordedClient([]); // throws: nothing recorded
  const { store, finished } = memoryStore();
  await assert.rejects(
    createPublish({ claude, store }).publish("u1", "i1"),
    PublishCheckFailed,
  );
  assert.equal(finished[0].verdict.approved, false);
});

test("the store's refusals pass through before any model call", async () => {
  const claude = recordedClient([]);
  const { store } = memoryStore();
  await assert.rejects(
    createPublish({ claude, store }).publish("u2", "i1"),
    /not yours/,
  );
  assert.equal(claude.requests.length, 0);
});
