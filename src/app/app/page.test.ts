// Unit tests for coverageBuckets (PER-271, audit finding H3).
//
// coverageBuckets classifies each requested topic into "missing" (the model
// dropped the section — actionable, Retry can recover it) vs "empty" (a
// section existed but had no fresh news today — honest, not an error, not
// retryable), per PER-154. It prefers the companion's authoritative `topics`
// field and falls back to the legacy `failedTopics` list for briefs cached
// before PER-154.
//
// Run with: pnpm test (root) or tsx --test src/app/app/page.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { coverageBuckets } from "./page";
import type { Brief } from "@/lib/types";

function baseBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    id: "b1",
    generatedAt: "2026-06-30T00:00:00.000Z",
    interests: ["AI safety", "Markets", "Climate tech"],
    articles: [],
    markdown: "",
    ...overrides,
  };
}

test("topics: classifies missing vs empty vs covered, excluding covered from both buckets", () => {
  const brief = baseBrief({
    topics: [
      { topic: "AI safety", status: "covered" },
      { topic: "Markets", status: "missing" },
      { topic: "Climate tech", status: "empty" },
    ],
  });
  assert.deepEqual(coverageBuckets(brief), {
    missing: ["Markets"],
    empty: ["Climate tech"],
  });
});

test("topics: all covered yields empty missing and empty buckets", () => {
  const brief = baseBrief({
    topics: [
      { topic: "AI safety", status: "covered" },
      { topic: "Markets", status: "covered" },
    ],
  });
  assert.deepEqual(coverageBuckets(brief), { missing: [], empty: [] });
});

test("topics: multiple missing/empty topics are collected in order", () => {
  const brief = baseBrief({
    topics: [
      { topic: "A", status: "missing" },
      { topic: "B", status: "empty" },
      { topic: "C", status: "missing" },
      { topic: "D", status: "empty" },
    ],
  });
  assert.deepEqual(coverageBuckets(brief), {
    missing: ["A", "C"],
    empty: ["B", "D"],
  });
});

test("legacy fallback: no topics field, failedTopics present, becomes missing with no empty bucket", () => {
  const brief = baseBrief({ failedTopics: ["Markets", "Climate tech"] });
  assert.deepEqual(coverageBuckets(brief), {
    missing: ["Markets", "Climate tech"],
    empty: [],
  });
});

test("legacy fallback: neither topics nor failedTopics present yields both buckets empty", () => {
  const brief = baseBrief();
  assert.deepEqual(coverageBuckets(brief), { missing: [], empty: [] });
});

test("an empty topics array is treated as absent — falls back to failedTopics, not to an all-empty classification", () => {
  const brief = baseBrief({ topics: [], failedTopics: ["Markets"] });
  assert.deepEqual(coverageBuckets(brief), { missing: ["Markets"], empty: [] });
});

test("topics present takes priority over failedTopics even when failedTopics is also set (post-PER-154 brief)", () => {
  const brief = baseBrief({
    topics: [{ topic: "Markets", status: "empty" }],
    // Stale legacy field a client might still be carrying — must be ignored
    // once the authoritative `topics` field is present.
    failedTopics: ["Markets"],
  });
  assert.deepEqual(coverageBuckets(brief), { missing: [], empty: ["Markets"] });
});
