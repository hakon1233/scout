import test from "node:test";
import assert from "node:assert/strict";
import type { ChatTurn } from "../src/index.ts";
import { chatTurnFromRow, chatTurnToRow } from "../src/index.ts";

test("a chat turn survives the round trip through its row", () => {
  const turn: ChatTurn = {
    id: "t1",
    created_at: "2026-11-20T08:00:00.000Z",
    status: "ready",
    message: "Drop AI, follow AI policy",
    reply: "Confirm below.",
    changes: [],
    pending_deletes: [{ interestId: "a", topic: "AI" }],
    pending_delete: { interestId: "a", topic: "AI" },
    pending_follows: [{ interestId: "p", topic: "AI policy" }],
    pending_creates: [
      { interestId: "n", topic: "Zigbee", doc: "# Zigbee", cadence: "weekly" },
    ],
  };
  const row = chatTurnToRow(turn);
  assert.deepEqual(row.pending, {
    deletes: [{ interestId: "a", topic: "AI" }],
    follows: [{ interestId: "p", topic: "AI policy" }],
    creates: [
      { interestId: "n", topic: "Zigbee", doc: "# Zigbee", cadence: "weekly" },
    ],
  });
  assert.deepEqual(chatTurnFromRow(row), turn);
});

test("a failed turn keeps its message and has no pending column", () => {
  const turn: ChatTurn = {
    id: "t2",
    created_at: "2026-11-20T08:00:00.000Z",
    status: "failed",
    message: "hi",
    error_msg: "Try again.",
  };
  const row = chatTurnToRow(turn);
  assert.equal(row.pending, null);
  assert.deepEqual(chatTurnFromRow(row), turn);
});
