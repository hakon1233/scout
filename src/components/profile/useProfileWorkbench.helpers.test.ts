import assert from "node:assert/strict";
import test from "node:test";

import type { ChatTurn } from "@/lib/chat";
import { transcriptMessages } from "./useProfileWorkbench.helpers";

test("transcriptMessages locks hydrated delete proposals consumed by a later confirm turn", () => {
  const turns: ChatTurn[] = [
    {
      id: "turn_1",
      created_at: "2026-07-11T12:00:00.000Z",
      status: "ready",
      message: "Drop AI",
      reply: "Delete AI? Confirm below.",
      pending_delete: { interestId: "int_ai", topic: "AI" },
    },
    {
      id: "turn_2",
      created_at: "2026-07-11T12:01:00.000Z",
      status: "ready",
      message: 'Delete "AI"',
      reply: 'Removed "AI" from your interests.',
      changes: [{ interestId: "int_ai", op: "delete", topic: "AI" }],
    },
  ];

  const scoutMessages = transcriptMessages(turns).filter(
    (message) => message.role === "scout",
  );

  assert.equal(scoutMessages[0].pendingDelete?.interestId, "int_ai");
  assert.equal(scoutMessages[0].deleteResolved, "deleted");
  assert.equal(scoutMessages[0].deleteAutoFocus, false);
});

test("transcriptMessages keeps unresolved hydrated proposals actionable without auto-focus", () => {
  const turns: ChatTurn[] = [
    {
      id: "turn_1",
      created_at: "2026-07-11T12:00:00.000Z",
      status: "ready",
      message: "Rewrite AI",
      reply: "Review the rewrite below.",
      pending_rewrite: {
        interestId: "int_ai",
        topic: "AI",
        doc: "# AI\n\nTrack policy.",
      },
    },
  ];

  const scoutMessage = transcriptMessages(turns).find(
    (message) => message.role === "scout",
  );

  assert.equal(scoutMessage?.pendingRewrite?.interestId, "int_ai");
  assert.equal(scoutMessage?.rewriteResolved, undefined);
  assert.equal(scoutMessage?.rewriteAutoFocus, false);
});

test("transcriptMessages locks hydrated rewrite proposals consumed by a later apply turn", () => {
  const turns: ChatTurn[] = [
    {
      id: "turn_1",
      created_at: "2026-07-11T12:00:00.000Z",
      status: "ready",
      message: "Rewrite AI",
      reply: "Review the rewrite below.",
      pending_rewrite: {
        interestId: "int_ai",
        topic: "AI",
        doc: "# AI\n\nTrack policy.",
      },
    },
    {
      id: "turn_2",
      created_at: "2026-07-11T12:01:00.000Z",
      status: "ready",
      message: 'Apply rewrite of "AI"',
      reply: 'Applied the rewrite of "AI".',
      changes: [
        {
          interestId: "int_ai",
          op: "update",
          topic: "AI",
          doc: "# AI\n\nTrack policy.",
        },
      ],
    },
  ];

  const scoutMessage = transcriptMessages(turns).find(
    (message) => message.pendingRewrite,
  );

  assert.equal(scoutMessage?.rewriteResolved, "applied");
  assert.equal(scoutMessage?.rewriteAutoFocus, false);
});
