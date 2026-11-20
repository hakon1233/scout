// The change-set rules: what of a model's proposal lands, waits or is dropped.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cadenceInWords,
  planChatChanges,
  type InterestSnapshot,
} from "../src/index.ts";

const AI: InterestSnapshot = { id: "int_ai", topic: "AI", doc: "# AI" };
const limits = { maxInterests: 3, maxTopicLen: 20 };

function ids() {
  let n = 0;
  return () => `new_${++n}`;
}

// UT-031: the model once proposed the same new topic twice in one turn, one
// bare and one with its intent doc, and the reader saw two confirm cards.
test("two creates of the same topic in one turn become one, keeping the fuller doc", () => {
  const plan = planChatChanges(
    [],
    [
      { op: "create", topic: "Norwegian heat pumps", cadence: "weekly" },
      {
        op: "create",
        topic: "norwegian heat pumps ",
        doc: "# Norwegian heat pumps\n\nPrices and policy.",
      },
    ],
    { ...limits, newId: ids() },
  );
  assert.deepEqual(plan.applied, [
    {
      interestId: "new_1",
      op: "create",
      topic: "Norwegian heat pumps",
      doc: "# Norwegian heat pumps\n\nPrices and policy.",
      cadence: "weekly",
    },
  ]);
  assert.equal(plan.interests.length, 1);
});

test("a create gets a minted id and a capped topic, and stops at the cap", () => {
  const plan = planChatChanges(
    [AI],
    [
      {
        op: "create",
        interestId: "model_id",
        topic: "x".repeat(30),
        doc: "# x",
      },
      { op: "create", topic: "Rust" },
      { op: "create", topic: "One too many" },
      { op: "create", topic: "   " },
    ],
    { ...limits, newId: ids() },
  );
  assert.deepEqual(plan.applied, [
    { interestId: "new_1", op: "create", topic: "x".repeat(20), doc: "# x" },
    { interestId: "new_2", op: "create", topic: "Rust", doc: "" },
  ]);
  assert.equal(plan.interests.length, 3);
});

test("an update applies at once and keeps what it doesn't name", () => {
  const plan = planChatChanges(
    [AI],
    [
      { op: "update", interestId: "int_ai", topic: "AI policy" },
      { op: "update", interestId: "int_other", doc: "# not yours" },
    ],
    { ...limits, newId: ids() },
  );
  assert.deepEqual(plan.applied, [
    { interestId: "int_ai", op: "update", topic: "AI policy", doc: "# AI" },
  ]);
  assert.deepEqual(plan.interests, [
    { id: "int_ai", topic: "AI policy", doc: "# AI" },
  ]);
});

test("deletes and full rewrites wait for a confirm, once per interest", () => {
  const plan = planChatChanges(
    [AI],
    [
      { op: "delete", interestId: "int_ai" },
      { op: "delete", interestId: "int_ai" },
      { op: "delete", interestId: "int_other" },
      { op: "rewrite", interestId: "int_ai", doc: "# New" },
      { op: "rewrite", interestId: "int_ai", doc: "# Newer" },
      { op: "rewrite", interestId: "int_ai", doc: "  " },
    ],
    { ...limits, newId: ids() },
  );
  assert.deepEqual(plan.applied, []);
  assert.deepEqual(plan.interests, [AI]);
  assert.deepEqual(plan.pendingDeletes, [
    { interestId: "int_ai", topic: "AI" },
  ]);
  assert.deepEqual(plan.pendingRewrites, [
    { interestId: "int_ai", topic: "AI", doc: "# New" },
  ]);
});

test("a follow must name an offered public interest", () => {
  const publicInterests = [{ id: "pub_policy", topic: "AI policy" }];
  const plan = planChatChanges(
    [AI],
    [
      { op: "follow", interestId: "pub_policy" },
      { op: "follow", interestId: "pub_policy" },
      { op: "follow", interestId: "pub_unlisted" },
      { op: "follow", interestId: "int_ai" },
    ],
    { ...limits, newId: ids(), publicInterests },
  );
  assert.deepEqual(plan.pendingFollows, [
    { interestId: "pub_policy", topic: "AI policy" },
  ]);
  const without = planChatChanges(
    [AI],
    [{ op: "follow", interestId: "pub_policy" }],
    { ...limits, newId: ids() },
  );
  assert.deepEqual(without.pendingFollows, []);
});

test("a doc over the plan's limit is dropped, never cut", () => {
  const long = "x".repeat(11);
  const plan = planChatChanges(
    [AI],
    [
      { op: "create", topic: "Rust", doc: long },
      { op: "update", interestId: "int_ai", doc: long },
      { op: "rewrite", interestId: "int_ai", doc: long },
      { op: "update", interestId: "int_ai", doc: "short" },
    ],
    { ...limits, maxDocChars: 10, newId: ids() },
  );
  assert.deepEqual(plan.applied, [
    { interestId: "int_ai", op: "update", topic: "AI", doc: "short" },
  ]);
  assert.deepEqual(plan.pendingRewrites, []);
});

test("unknown ops and junk fields are dropped", () => {
  const plan = planChatChanges(
    [AI],
    [
      { op: "rename", interestId: "int_ai" },
      { op: "update", interestId: 42 },
      { op: "create", topic: { evil: true } },
    ],
    { ...limits, newId: ids() },
  );
  assert.deepEqual(plan.applied, []);
  assert.deepEqual(plan.interests, [AI]);
});

test("cadenceInWords reads daily or weekly from the reader's words", () => {
  assert.equal(cadenceInWords("Home Assistant changes, weekly"), "weekly");
  assert.equal(cadenceInWords("Weekly brief."), "weekly");
  assert.equal(cadenceInWords("once a week please"), "weekly");
  assert.equal(cadenceInWords("every day, short"), "daily");
  assert.equal(cadenceInWords("a daily brief on AI"), "daily");
  assert.equal(cadenceInWords("Rust releases"), null);
  // Both named: the words don't settle it.
  assert.equal(cadenceInWords("daily or weekly, you pick"), null);
});

test("a create takes the cadence the reader asked for over the model's", () => {
  const plan = planChatChanges(
    [],
    [
      { op: "create", topic: "Zigbee", doc: "# Zigbee", cadence: "daily" },
      { op: "create", topic: "Odd", cadence: "hourly" },
    ],
    { ...limits, newId: ids(), message: "A private topic on Zigbee. Weekly." },
  );
  assert.deepEqual(
    plan.applied.map((c) => [c.topic, c.cadence]),
    [
      ["Zigbee", "weekly"],
      ["Odd", "weekly"],
    ],
  );
  const unsaid = planChatChanges(
    [],
    [
      { op: "create", topic: "Rust", cadence: "weekly" },
      { op: "create", topic: "Odd", cadence: "hourly" },
    ],
    { ...limits, newId: ids(), message: "Rust releases" },
  );
  assert.deepEqual(
    unsaid.applied.map((c) => c.cadence),
    ["weekly", undefined],
  );
});
