// The trusted applier: what of a model's proposed changes lands.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyChatChanges } from "../src/chat-changes.js";
import { MAX_INTEREST_LEN } from "../src/limits.js";

test("a topic from the model is capped at the same length the HTTP API allows", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scout-changes-"));
  try {
    const long = "x".repeat(MAX_INTEREST_LEN + 50);
    const { interests } = await applyChatChanges(
      [{ id: "int_a", topic: "AI" }],
      [
        { op: "create", topic: long, doc: "# doc" },
        { op: "update", interestId: "int_a", topic: long },
      ],
      dir,
    );
    assert.deepEqual(
      interests.map((i) => i.topic.length),
      [MAX_INTEREST_LEN, MAX_INTEREST_LEN],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
