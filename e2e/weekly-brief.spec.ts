import { expect, test } from "@playwright/test";
import { PORT } from "./port";

// "Weekly brief" from the profile menu: it renders as a weekly edition built
// from the daily history, with a story repeated across days shown once.
//
// Single interest on purpose: the companion runs one research session per
// interest and `extractTopicSection` keeps that session's FIRST `##` block
// (coverage.ts) — in production each session researches one topic, but the
// stub emits a fixed brief, so every session resolves to its first section
// ("AI safety" → "Alignment update"). That canonical single story is the unit
// the daily → weekly pipeline carries, so we assert on it (same reason
// zero-prompt.spec only ever asserts "Alignment update").
//
// Determinism/offline: the daily `claude` shell-out is stubbed
// (SCOUT_CLAUDE_BIN); the weekly assembly is pure history aggregation; and every
// non-loopback request is blocked below. No Claude account, no quota, no net.

const ORIGIN = `http://127.0.0.1:${PORT}`;

// Belt-and-suspenders offline guard (mirrors zero-prompt.spec): abort any
// request that isn't to the loopback companion, so a stray remote dependency in
// the weekly flow fails loudly instead of silently reaching the network.
async function blockNonLoopback(page: import("@playwright/test").Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost")
    ) {
      return route.continue();
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return route.continue(); // data:, blob:, about: — harmless
    }
    return route.abort();
  });
}

// Fire "Run now" from the profile menu and wait for the daily edition's card to
// land. Each call persists one daily brief into the companion's rolling history.
async function runDailyBrief(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  const runNow = page.getByRole("button", { name: "Run now" });
  await expect(runNow).toBeEnabled({ timeout: 15_000 });
  await runNow.click();
  await expect(
    page.getByRole("button", { name: /Alignment update/ }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

test("weekly brief assembles the week's daily stories, de-duplicated, under a Weekly-brief header", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await blockNonLoopback(page);

  // Seed the post-setup precondition directly (the in-page setup form was
  // removed; interests are chat-driven, which a hermetic stub run
  // can't drive). Same shape saveSettings writes — see zero-prompt.spec.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "E2E Tester",
        interests: [{ id: "int_0_aisafety", topic: "AI safety" }],
      }),
    );
    window.localStorage.setItem("scout.theme", "light");
  });

  await page.goto(`${ORIGIN}/app/`);

  // Companion is paired same-origin (zero-prompt covers auto-adoption in
  // detail); the pairing prompt's absence is our readiness signal before firing.
  await expect(page.getByRole("link", { name: /Pair companion/i })).toHaveCount(
    0,
  );

  // 1. Seed TWO daily runs into the companion's history, so the weekly genuinely
  //    has to collapse the repeated story rather than trivially carrying one.
  //    Each run is a distinct daily brief (new id/timestamp) carrying the same
  //    canonical story URL (https://example.com/alignment).
  await runDailyBrief(page);
  await runDailyBrief(page);

  // 2. Fire the weekly brief from the profile menu. It is disabled while a run
  //    is in flight, so toBeEnabled also gates on the daily run having settled.
  await page.getByRole("button", { name: "Open settings" }).click();
  const weekly = page.getByRole("button", { name: "Weekly brief" });
  await expect(weekly).toBeEnabled({ timeout: 15_000 });
  await weekly.click();

  // 3. The current edition is now a weekly brief. BriefLayout renders each brief
  //    as an <article aria-label="<title> — <date>">; a `kind:"weekly"` brief
  //    titles it "Weekly brief" (vs the daily "Your brief"). `.first()` is the
  //    current edition — it renders above the BriefHistory pager, which may hold
  //    earlier weekly editions from other specs sharing the companion history.
  const weeklyEdition = page
    .locator('article[aria-label^="Weekly brief —"]')
    .first();
  await expect(weeklyEdition).toBeVisible({ timeout: 30_000 });
  await expect(weeklyEdition.getByRole("heading", { level: 1 })).toContainText(
    "Weekly brief",
  );

  // The on-demand success confirmation — a fresh brief actually
  // landed, not a silent swap.
  await expect(page.getByText("Fresh brief delivered")).toBeVisible();

  // 4. The two daily runs' identical story is collapsed to a single card in the
  //    assembled weekly edition — createWeeklyBriefFromHistory's URL dedup (and
  //    the feed's canonical-URL dedup) working end-to-end through the real flow.
  await expect(
    weeklyEdition.getByRole("button", { name: /Alignment update/ }),
  ).toHaveCount(1);

  // Green-run baseline artifact (Playwright also keeps one on failure).
  await testInfo.attach("weekly-brief", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
