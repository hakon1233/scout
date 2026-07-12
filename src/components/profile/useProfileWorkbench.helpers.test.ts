import assert from "node:assert/strict";
import test from "node:test";

import type { ChatTurn } from "@/lib/chat";
import {
  appliedChangeMessage,
  transcriptMessages,
} from "./useProfileWorkbench.helpers";

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

test("transcriptMessages keeps an unconfirmed rewrite actionable after an unrelated incremental update to the same interest", () => {
  // A rewrite proposal locks to "applied" only when its EXACT proposed doc was
  // confirmed (confirmRewriteTurn echoes it as the applied update's `doc`). A
  // NORMAL incremental `update` — different doc, never an apply of this rewrite —
  // must NOT lock the still-pending proposal, or reload would strip the [Apply]
  // button and dishonestly claim a rewrite the user never ran.
  const turns: ChatTurn[] = [
    {
      id: "turn_1",
      created_at: "2026-07-11T12:00:00.000Z",
      status: "ready",
      message: "Rewrite AI from scratch about policy",
      reply: "Here's a full rewrite — review and Apply below.",
      pending_rewrite: {
        interestId: "int_ai",
        topic: "AI",
        doc: "# AI\n\nFull rewrite focused on policy.",
      },
    },
    {
      id: "turn_2",
      created_at: "2026-07-11T12:05:00.000Z",
      status: "ready",
      message: "also add a note about chip export controls",
      reply: "Added a note about chip export controls.",
      // Incremental refine — a DIFFERENT doc than the pending rewrite above.
      changes: [
        {
          interestId: "int_ai",
          op: "update",
          topic: "AI",
          doc: "# AI\n\nExisting doc plus a chip export controls note.",
        },
      ],
    },
  ];

  const rewriteCard = transcriptMessages(turns).find((m) => m.pendingRewrite);

  assert.equal(rewriteCard?.pendingRewrite?.interestId, "int_ai");
  assert.equal(rewriteCard?.rewriteResolved, undefined);
});

test("appliedChangeMessage surfaces a confirmed rewrite as an undoable action card (AIR-611)", () => {
  const turn: ChatTurn = {
    id: "turn_apply",
    created_at: "2026-07-12T12:00:00.000Z",
    status: "ready",
    message: 'Apply rewrite of "AI"',
    reply: 'Applied the rewrite of "AI".',
    changes: [
      { interestId: "int_ai", op: "update", topic: "AI", doc: "# AI\n\nNew." },
    ],
  };

  const msg = appliedChangeMessage(turn, "int_ai", "# AI\n\nOld.");

  assert.ok(msg);
  assert.equal(msg.role, "scout");
  assert.equal(msg.text, 'Applied the rewrite of "AI".');
  assert.equal(msg.ts, "2026-07-12T12:00:00.000Z");
  assert.deepEqual(msg.changes, turn.changes);
  // The pre-change body is carried keyed by interestId so ChatActionCard can
  // diff old→new and undo can revert to it verbatim — the shape dispatch() gives
  // a live turn, which is what powers the Undo button.
  assert.equal(msg.prev?.int_ai, "# AI\n\nOld.");
});

test("appliedChangeMessage carries the pre-delete doc so undo can re-create it verbatim (AIR-611)", () => {
  const turn: ChatTurn = {
    id: "turn_del",
    created_at: "2026-07-12T12:01:00.000Z",
    status: "ready",
    message: 'Delete "AI"',
    reply: 'Removed "AI" from your interests.',
    changes: [{ interestId: "int_ai", op: "delete", topic: "AI" }],
  };

  const msg = appliedChangeMessage(turn, "int_ai", "# AI\n\nBody.");

  assert.ok(msg);
  assert.equal(msg.changes?.[0].op, "delete");
  assert.equal(msg.prev?.int_ai, "# AI\n\nBody.");
});

test("appliedChangeMessage returns null when the confirm turn applied nothing", () => {
  const turn: ChatTurn = {
    id: "turn_noop",
    created_at: "2026-07-12T12:02:00.000Z",
    status: "ready",
    message: "noop",
    reply: "nothing changed",
  };

  assert.equal(appliedChangeMessage(turn, "int_ai", null), null);
});
