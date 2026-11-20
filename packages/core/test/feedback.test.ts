import test from "node:test";
import assert from "node:assert/strict";
import type { ChatTurn } from "../src/index.ts";
import {
  MAX_FEEDBACK_SUMMARY_CHARS,
  MAX_FEEDBACK_TEXT_CHARS,
  buildChatPrompt,
  chatTurnFromRow,
  chatTurnToRow,
  feedbackOf,
} from "../src/index.ts";

const AI = { id: "int_ai", topic: "AI", doc: "# AI" };

test("with feedback off the chat prompt is exactly today's", () => {
  const opts = { maxInterests: 15, maxDocChars: 4000, cadences: true };
  const today = buildChatPrompt("hi", [AI], [], opts);
  assert.equal(
    buildChatPrompt("hi", [AI], [], { ...opts, feedback: false }),
    today,
  );
  assert.doesNotMatch(today, /feedback/i);
});

// UT-032: with feedback off, a "report a bug" ask got a reply about a Settings
// bug form that doesn't exist. The prompt says plainly there is no channel.
test("with feedback off the prompt says reports can't be sent yet and points nowhere", () => {
  const prompt = buildChatPrompt("I want to report a bug", [AI], [], {
    maxInterests: 15,
    cadences: true,
  });
  assert.match(prompt, /no way to report a bug/i);
  assert.match(prompt, /never point to a form, page or address/i);
  const on = buildChatPrompt("I want to report a bug", [AI], [], {
    maxInterests: 15,
    cadences: true,
    feedback: true,
  });
  assert.doesNotMatch(on, /no way to report a bug/i);
});

test("with feedback on the prompt offers the feedback op and its rules", () => {
  const prompt = buildChatPrompt("The feed is blank", [AI], [], {
    maxInterests: 15,
    cadences: true,
    feedback: true,
  });
  assert.match(prompt, /"op": "feedback"/);
  assert.match(prompt, /CONFIRM-GATED/);
  assert.match(prompt, /never say it is sent/i);
  assert.match(prompt, /personal details/);
});

test("feedbackOf takes the first well-formed feedback op and checks every field", () => {
  assert.equal(feedbackOf([]), undefined);
  assert.equal(feedbackOf([{ op: "create", topic: "x" }]), undefined);
  assert.equal(
    feedbackOf([{ op: "feedback", kind: "rant", summary: "a", text: "b" }]),
    undefined,
  );
  assert.equal(
    feedbackOf([{ op: "feedback", kind: "bug", summary: " ", text: "b" }]),
    undefined,
  );
  assert.equal(
    feedbackOf([{ op: "feedback", kind: "bug", summary: "a", text: 3 }]),
    undefined,
  );
  assert.deepEqual(
    feedbackOf([
      { op: "update", interestId: "int_ai" },
      {
        op: "feedback",
        kind: "wish",
        summary: "  Dark mode for the feed  ",
        text: " Please add dark mode. ",
      },
      { op: "feedback", kind: "bug", summary: "second", text: "second" },
    ]),
    {
      kind: "wish",
      summary: "Dark mode for the feed",
      text: "Please add dark mode.",
    },
  );
  const long = feedbackOf([
    {
      op: "feedback",
      kind: "other",
      summary: "s".repeat(500),
      text: "t".repeat(9000),
    },
  ]);
  assert.equal(long?.summary.length, MAX_FEEDBACK_SUMMARY_CHARS);
  assert.equal(long?.text.length, MAX_FEEDBACK_TEXT_CHARS);
});

test("a feedback card survives the round trip through its chat row", () => {
  const turn: ChatTurn = {
    id: "t1",
    created_at: "2026-11-20T08:00:00.000Z",
    status: "ready",
    message: "The feed is blank on my phone",
    reply: "Sorry about that. Send it to the Scout team? Confirm below.",
    changes: [],
    pending_feedback: {
      kind: "bug",
      summary: "Feed is blank on a phone",
      text: "The feed shows nothing on my phone after sign-in.",
    },
  };
  const row = chatTurnToRow(turn);
  assert.deepEqual(row.pending, { feedback: turn.pending_feedback });
  assert.deepEqual(chatTurnFromRow(row), turn);
});
