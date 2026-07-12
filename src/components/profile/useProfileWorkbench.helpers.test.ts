import test from "node:test";
import assert from "node:assert/strict";

import type { ChatTurn } from "@/lib/chat";
import { transcriptMessages } from "./useProfileWorkbench.helpers";

function readyTurn(overrides: Partial<ChatTurn>): ChatTurn {
  return {
    id: "turn-1",
    message: "change it",
    status: "ready",
    created_at: "2026-07-12T10:00:00.000Z",
    reply: "",
    ...overrides,
  };
}

test("AIR-645: reloaded pending delete turns render inert instead of re-armed", () => {
  const messages = transcriptMessages([
    readyTurn({
      pending_delete: {
        interestId: "rust-async",
        topic: "Rust async",
      },
    }),
  ]);

  const scout = messages.find((m) => m.role === "scout");
  assert.ok(scout, "expected a scout message for the persisted pending delete");
  assert.deepEqual(scout.pendingDelete, {
    interestId: "rust-async",
    topic: "Rust async",
  });
  assert.equal(scout.deleteResolved, "cancelled");
});

test("AIR-645: reloaded pending rewrite turns render inert instead of re-armed", () => {
  const messages = transcriptMessages([
    readyTurn({
      pending_rewrite: {
        interestId: "chips",
        topic: "Semiconductors",
        doc: "# Semiconductors\n\nTrack export controls.",
      },
    }),
  ]);

  const scout = messages.find((m) => m.role === "scout");
  assert.ok(scout, "expected a scout message for the persisted pending rewrite");
  assert.deepEqual(scout.pendingRewrite, {
    interestId: "chips",
    topic: "Semiconductors",
    doc: "# Semiconductors\n\nTrack export controls.",
  });
  assert.equal(scout.rewriteResolved, "discarded");
});
