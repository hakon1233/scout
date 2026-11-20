import test from "node:test";
import assert from "node:assert/strict";
import { quotaMessage } from "../src/index.ts";

test("each quota hint reads as a sentence with the plan's number", () => {
  assert.equal(
    quotaMessage({
      code: "P0001",
      hint: "max_interests",
      message: "quota: 15 of 15 interests used",
    }),
    "Your plan has room for 15 interests, and they're in use. Delete one first.",
  );
  assert.equal(
    quotaMessage({
      code: "P0001",
      hint: "daily_interests",
      message: "quota: 1 of 1 daily interests used",
    }),
    "Your plan has room for 1 daily interest, and it's in use. Set one to weekly or pause it first.",
  );
  assert.match(
    quotaMessage({ code: "P0001", hint: "max_doc_chars" }) ?? "",
    /too long/,
  );
  assert.equal(
    quotaMessage({
      code: "P0001",
      hint: "max_public_interests",
      message: "quota: 3 of 3 public interests used",
    }),
    "Your plan has room for 3 public interests, and they're in use. Make one shared or private first.",
  );
  assert.equal(
    quotaMessage({
      code: "P0001",
      hint: "spend_per_day_usd",
      message: "quota: spend limit of $0.40 reached",
    }),
    "You have reached today's spending limit. Try again tomorrow.",
  );
});

test("anything that is not a quota refusal gives null", () => {
  assert.equal(quotaMessage({ code: "23505", message: "duplicate" }), null);
  assert.equal(quotaMessage({ code: "P0001", hint: "other" }), null);
  assert.equal(quotaMessage({}), null);
});
