import assert from "node:assert/strict";
import test from "node:test";

import {
  dismissLocally,
  readDismissed,
  splitNotices,
  visibleNotices,
  type FeedNotice,
} from "./feed-notices";
import {
  HOME_SCREEN_INTERVAL_MS,
  markShown,
  readLastShown,
  shouldShowHomeScreenCard,
} from "./home-screen";
import {
  planFor,
  planGains,
  planLines,
  planMeters,
  planUsage,
  dailyOffered,
  priceAbroadText,
  priceText,
} from "./plans";
import { defaultTimeZone, timeZoneOptions } from "./time-zone";

// The redesign's small rules: the Home Screen card's once-a-week rule, notice
// dismissal, the time-zone default and the plan meters.

function withStorage(fn: () => void) {
  const previous = globalThis.window;
  const backing = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  };
  try {
    fn();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

const phone = { phone: true, installed: false, iphone: true };
const now = Date.UTC(2026, 10, 20, 8);

test("Home Screen card: phone only, never once installed", () => {
  assert.equal(
    shouldShowHomeScreenCard({ device: phone, lastShownAt: null, now }),
    true,
  );
  assert.equal(
    shouldShowHomeScreenCard({
      device: { ...phone, phone: false },
      lastShownAt: null,
      now,
    }),
    false,
  );
  assert.equal(
    shouldShowHomeScreenCard({
      device: { ...phone, installed: true },
      lastShownAt: null,
      now,
    }),
    false,
  );
});

test("Home Screen card: at most once a week", () => {
  const day = 24 * 60 * 60 * 1000;
  const shownAt = (ago: number) => ({
    device: phone,
    lastShownAt: now - ago,
    now,
  });
  assert.equal(shouldShowHomeScreenCard(shownAt(day)), false);
  assert.equal(shouldShowHomeScreenCard(shownAt(6 * day)), false);
  assert.equal(
    shouldShowHomeScreenCard(shownAt(HOME_SCREEN_INTERVAL_MS)),
    true,
  );
});

test("Home Screen card: the last showing persists; junk reads as never", () => {
  withStorage(() => {
    assert.equal(readLastShown(), null);
    markShown(now);
    assert.equal(readLastShown(), now);
    window.localStorage.setItem("scout.homeScreenCard.v1", "soon");
    assert.equal(readLastShown(), null);
  });
});

const notice = (id: string): FeedNotice => ({
  id,
  kind: "run_failed",
  topic: "Markets",
  at: null,
});

test("notices: a dismissed one stays hidden on this device", () => {
  withStorage(() => {
    const all = [notice("a"), notice("b")];
    assert.deepEqual(visibleNotices(all, readDismissed()), all);
    dismissLocally("a");
    assert.deepEqual(
      visibleNotices(all, readDismissed()).map((n) => n.id),
      ["b"],
    );
  });
});

test("notices: corrupt storage reads as none dismissed; the list is capped", () => {
  withStorage(() => {
    window.localStorage.setItem("scout.dismissedNotices.v1", "{not json");
    assert.equal(readDismissed().size, 0);
    for (let i = 0; i < 60; i++) dismissLocally(`n${i}`);
    const kept = readDismissed();
    assert.equal(kept.size, 50);
    assert.ok(kept.has("n59") && !kept.has("n0"));
  });
});

test("notices: the first few show, the rest sit behind Show N more", () => {
  const list = ["a", "b", "c", "d"].map(notice);
  const { shown, more } = splitNotices(list, 2);
  assert.deepEqual(
    shown.map((n) => n.id),
    ["a", "b"],
  );
  assert.equal(more, 2);
  assert.equal(splitNotices(list.slice(0, 1), 2).more, 0);
});

test("time zone: the saved one wins, else the browser's", () => {
  assert.equal(
    defaultTimeZone("Europe/Oslo", "America/New_York"),
    "Europe/Oslo",
  );
  assert.equal(defaultTimeZone(null, "America/New_York"), "America/New_York");
  assert.equal(defaultTimeZone("  ", "Asia/Tokyo"), "Asia/Tokyo");
  assert.ok(timeZoneOptions("Mars/Base").includes("Mars/Base"));
  assert.ok(timeZoneOptions("UTC").includes("UTC"));
});

test("plan meters: the schedule slots the plan allows, follows don't count", () => {
  const meters = planMeters({
    plan: "free",
    daily: { used: 0, limit: 0 },
    weekly: { used: 2, limit: 3 },
    runsToday: { used: 2, limit: 3 },
    publicTopics: 1,
  });
  assert.deepEqual(meters, [
    { label: "Weekly topics", used: 2, limit: 3 },
    { label: "Public topics", used: 1, limit: 3 },
    { label: "Run now today", used: 2, limit: 3 },
  ]);
  assert.deepEqual(
    planMeters({
      plan: "plus",
      daily: { used: 1, limit: 1 },
      weekly: { used: 2, limit: 6 },
      runsToday: { used: 0, limit: 3 },
      publicTopics: 0,
    }).slice(0, 2),
    [
      { label: "Daily topics", used: 1, limit: 1 },
      { label: "Weekly topics", used: 2, limit: 6 },
    ],
  );
  assert.equal(
    planUsage(planFor("free"), { daily: 0, weekly: 2, public: 0 }),
    "2 of 3 weekly, 0 of 3 public",
  );
  assert.equal(
    planUsage(planFor("plus"), { daily: 1, weekly: 2, public: 1 }),
    "1 of 1 daily, 2 of 6 weekly, 1 of 3 public",
  );
  assert.equal(dailyOffered(planFor("free")), false);
  assert.equal(dailyOffered(planFor("plus")), true);
  assert.equal(planFor("unknown").id, "free");
  assert.deepEqual(planLines(planFor("free")).slice(0, 3), [
    "3 weekly briefs",
    "Daily briefs: Plus only",
    "15 topics in all",
  ]);
  assert.deepEqual(planLines(planFor("plus")).slice(0, 2), [
    "1 daily and 6 weekly briefs",
    "30 topics in all",
  ]);
  assert.deepEqual(planGains(planFor("plus")), [
    "1 daily and 6 weekly briefs",
    "30 topics in all",
    "Everything else in Free",
  ]);
  assert.equal(priceText(planFor("plus")), "49 kr a month");
  assert.equal(priceAbroadText(planFor("plus")), "About $5 a month");
  assert.equal(priceAbroadText(planFor("free")), null);
});
