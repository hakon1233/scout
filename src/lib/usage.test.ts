import assert from "node:assert/strict";
import test from "node:test";

import type { UsageEvent } from "./hosted";
import { createUsageTracker, startUsage, stopUsage, usage } from "./usage";

// Usage events: queued, sent in batches, flushed when the page is hidden.

const TOPICS = [
  { id: "i-climate", topic: "Climate" },
  { id: "i-ai", topic: "AI policy" },
];

function setup(max = 50) {
  const batches: UsageEvent[][] = [];
  let t = 0;
  const tracker = createUsageTracker({
    send: async (e) => {
      batches.push(e);
    },
    now: () => t,
    max,
  });
  tracker.setTopics(TOPICS);
  return {
    tracker,
    batches,
    advance(ms: number) {
      t += ms;
    },
  };
}

test("nothing is sent until the page is hidden; then one batch with everything", () => {
  const { tracker, batches, advance } = setup();
  tracker.briefViewed("b1", ["Climate", "AI policy"]);
  tracker.storyOpened("climate", "https://example.com/story?utm_source=x");
  advance(12_400);
  assert.equal(batches.length, 0);
  tracker.hidden();
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].map((e) => e.kind),
    ["brief_view", "brief_view", "story_click", "story_seconds"],
  );
  const seconds = batches[0][3];
  assert.ok(seconds.kind === "story_seconds" && seconds.seconds === 12);
  tracker.hidden();
  assert.equal(batches.length, 1, "an empty queue sends nothing");
});

test("a full queue goes out at once", () => {
  const { tracker, batches } = setup(3);
  for (let i = 0; i < 7; i++)
    tracker.storyOpened("Climate", `https://example.com/${i}`);
  assert.deepEqual(
    batches.map((b) => b.length),
    [3, 3],
  );
});

test("story time pauses while hidden and skips under a second", () => {
  const { tracker, batches, advance } = setup();
  tracker.storyOpened("AI policy", "https://example.com/a");
  advance(4_000);
  tracker.hidden();
  advance(60_000); // out of sight: not counted
  tracker.visible();
  advance(3_000);
  tracker.storyClosed();
  tracker.storyOpened("AI policy", "https://example.com/b");
  advance(400);
  tracker.storyClosed();
  tracker.flush();
  const seconds = batches
    .flat()
    .filter((e) => e.kind === "story_seconds")
    .map((e) => (e.kind === "story_seconds" ? e.seconds : 0));
  assert.deepEqual(seconds, [4, 3]);
});

test("a brief view counts once per brief and topic; unknown topics are skipped", () => {
  const { tracker, batches } = setup();
  tracker.briefViewed("b1", ["Climate", "climate", "Unknown"]);
  tracker.briefViewed("b1", ["Climate"]);
  tracker.briefViewed("b2", ["Climate"]);
  tracker.storyOpened("Unknown", "https://example.com/x");
  tracker.flush();
  assert.deepEqual(batches.flat(), [
    { kind: "brief_view", interestId: "i-climate" },
    { kind: "brief_view", interestId: "i-climate" },
  ]);
});

test("the page's tracker records nothing before startUsage, except briefs kept for it", async () => {
  stopUsage();
  const sent: UsageEvent[] = [];
  const data = {
    sendEvents: async (e: UsageEvent[]) => {
      sent.push(...e);
    },
  };
  usage.storyOpened("Climate", "https://example.com/early");
  usage.briefViewed("b1", ["Climate"]);
  assert.deepEqual(sent, []);
  startUsage(data, TOPICS);
  usage.storyClosed();
  // Node has no window: flush by hand through a story that closes.
  usage.storyOpened("AI policy", "https://example.com/late");
  stopUsage();
  assert.deepEqual(sent, [], "queued, not sent before the page hides");

  // Signed out (never started): nothing at all.
  usage.storyOpened("Climate", "https://example.com/none");
  assert.deepEqual(sent, []);
});

test("briefs shown before start are recorded once it starts", () => {
  stopUsage();
  const sent: UsageEvent[][] = [];
  usage.briefViewed("b1", ["Climate"]);
  startUsage(
    {
      sendEvents: async (e) => {
        sent.push(e);
      },
    },
    TOPICS,
  );
  // Fill a batch of 50 so it sends without a page to hide.
  for (let i = 0; i < 49; i++)
    usage.storyOpened("Climate", `https://example.com/${i}`);
  stopUsage();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][0], { kind: "brief_view", interestId: "i-climate" });
});
