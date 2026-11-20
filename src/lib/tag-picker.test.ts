import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TAGS, SEED_TAGS } from "@scout/core";
import {
  FREE_TAG_MIN_TOPICS,
  cleanTag,
  popularTags,
  searchTags,
  toggleTag,
} from "./tag-picker";

// The tag picker's rules: chips by use, search with a free tag, a cap.

test("cleanTag lowercases, drops a leading # and refuses non-tags", () => {
  assert.equal(cleanTag("  #Climate "), "climate");
  assert.equal(cleanTag("Machine Learning"), "machine-learning");
  assert.equal(cleanTag("x"), null);
  assert.equal(cleanTag("no_underscores"), null);
});

test("popular tags: used seed tags first, free tags only once enough topics use them, then the seed list", () => {
  const seed = SEED_TAGS[5];
  const chips = popularTags(
    [
      { tag: "rare-free", topics: FREE_TAG_MIN_TOPICS - 1 },
      { tag: "common-free", topics: FREE_TAG_MIN_TOPICS + 5 },
      { tag: seed, topics: 2 },
    ],
    6,
  );
  assert.deepEqual(chips.slice(0, 2), ["common-free", seed]);
  assert.ok(!chips.includes("rare-free"));
  assert.equal(chips.length, 6);
  assert.equal(new Set(chips).size, 6);
});

test("search: known tags that start with the query, then ones containing it, never ones already picked", () => {
  const counts = [
    { tag: "ai-policy", topics: 4 },
    { tag: "open-ai", topics: 3 },
    { tag: "air-travel", topics: 9 },
  ];
  const { matches } = searchTags("ai", {
    selected: ["ai-policy"],
    counts,
  });
  assert.equal(matches[0], "air-travel");
  assert.ok(matches.includes("open-ai"));
  assert.ok(!matches.includes("ai-policy"));
});

test("search offers the query itself as a new tag when nobody uses it", () => {
  const { free } = searchTags("Fjord Fishing", { selected: [], counts: [] });
  assert.equal(free, "fjord-fishing");
  assert.equal(
    searchTags("x", { selected: [], counts: [] }).free,
    null,
    "too short to be a tag",
  );
});

test("toggleTag adds, removes, and adds nothing once full", () => {
  assert.deepEqual(toggleTag([], "Climate"), ["climate"]);
  assert.deepEqual(toggleTag(["climate"], "climate"), []);
  const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag-${i}`);
  assert.deepEqual(toggleTag(full, "one-more"), full);
  assert.deepEqual(toggleTag(full, "tag-0"), full.slice(1));
  assert.deepEqual(toggleTag(["a1"], "a2", 10), ["a1", "a2"]);
});
