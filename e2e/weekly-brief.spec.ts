import { expect, test } from "@playwright/test";

// AIR-267 — headless E2E for the "Weekly brief" profile-menu flow (POST
// /v0/weekly-brief). The weekly brief is assembled ENTIRELY from the
// companion's rolling daily-brief history (packages/agent/src/weekly.ts) — no
// `claude` shell-out — so it runs fully offline and deterministically, from the
// same canned daily story the stub yields.
//
// What this proves that the existing specs don't:
//   1. The "Weekly brief" menuitem fires runWeekly → generateWeeklyBrief →
//      POST /v0/weekly-brief → adaptBrief → render. No other spec exercises the
//      weekly path; "Run now" (zero-prompt, liked-live-flow) only covers daily.
//   2. The result renders as a `kind:"weekly"` brief: the current edition's
//      header reads "Weekly brief — <date>" (BriefLayout's `kind:"weekly"` title
//      branch), NOT the daily "Your brief — <date>".
//   3. createWeeklyBriefFromHistory de-duplicates stories by URL across the
//      week's daily runs: we generate the SAME canned story on two separate
//      daily runs, yet it appears EXACTLY once in the assembled weekly edition.
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
// non-loopback request is blocked below. No Anthropic/Exa key, no quota, no net.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
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
  const runNow = page.getByRole("menuitem", { name: "Run now" });
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
  // removed in PER-188; interests are chat-driven, which a hermetic stub run
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
  const weekly = page.getByRole("menuitem", { name: "Weekly brief" });
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

  // The on-demand success confirmation (PER-150) — a fresh brief actually
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
