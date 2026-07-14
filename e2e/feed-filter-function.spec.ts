import { expect, test } from "@playwright/test";

// AIR-217 (/qa-live) — functional coverage for the PER-241 feed filter.
//
// feed-filter-theme.spec asserts only the funnel button/menu CSS tokens; it
// never proves the filter actually *narrows the feed*. The filter is pure
// client logic (app/page.tsx: `filteredBrief` keeps articles whose
// `interest === activeFilter`), so this spec seeds a two-topic brief straight
// into the app's localStorage cache (`scout.lastBrief.v1`, the exact shape
// saveLastBrief writes) and drives the real funnel UI:
//   1. both topics' stories render with no filter,
//   2. selecting one topic hides the other story,
//   3. the active filter is announced for assistive tech,
//   4. "All topics" restores the full feed.
//
// Seeding the brief (rather than firing a stub run) isolates the filter under
// test from the single-section offline stub, and keeps the suite fully offline:
// the non-loopback guard aborts every external request, so there is no real
// Anthropic/Exa key, no quota, no network, no paid Apify scrape.
//
// The seeded brief must satisfy storage.ts's isBrief() shape (markdown:
// string, topics[].status one of TopicStatus) since loadLastBrief() now
// rejects anything else (commit 27cc55c, "reject malformed cached briefs")
// — this fixture predates that validation and silently relied on the old
// unchecked parse; a missing `markdown` + a bogus `status: "ok"` made
// loadLastBrief() start returning null, so the feed rendered no cards at all.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

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

test("feed filter narrows the feed to the selected topic and restores it", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await blockNonLoopback(page);

  // Seed two interests (so the funnel offers both topics) and a cached brief
  // carrying one story per topic with distinct canonical URLs (so neither is
  // deduped away by FeedView.buildFeed).
  await page.addInitScript(() => {
    window.localStorage.setItem("scout.theme", "light");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "Filter Tester",
        interests: [
          { id: "int_ai_safety", topic: "AI safety" },
          { id: "int_markets", topic: "Markets" },
        ],
      }),
    );
    window.localStorage.setItem(
      "scout.lastBrief.v1",
      JSON.stringify({
        id: "seed-brief-1",
        generatedAt: "2026-06-26T05:00:00.000Z",
        interests: ["AI safety", "Markets"],
        markdown: "",
        topics: [
          { topic: "AI safety", status: "covered" },
          { topic: "Markets", status: "covered" },
        ],
        articles: [
          {
            id: "seed-brief-1-0",
            title: "Alignment update",
            url: "https://example.com/alignment",
            source: "example.com",
            interest: "AI safety",
            text: "A research lab published new alignment results this week.",
          },
          {
            id: "seed-brief-1-1",
            title: "Markets recap",
            url: "https://news.example.org/markets",
            source: "news.example.org",
            interest: "Markets",
            text: "Indices closed higher on fresh inflation data.",
          },
        ],
      }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);

  // Both topics' stories render in the unfiltered feed.
  const aiCard = page.getByRole("button", { name: /Alignment update/ });
  const marketsCard = page.getByRole("button", { name: /Markets recap/ });
  await expect(aiCard).toBeVisible({ timeout: 15_000 });
  await expect(marketsCard).toBeVisible();

  await testInfo.attach("feed-unfiltered.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  // Apply the "Markets" filter via the funnel dropdown.
  await page.getByRole("button", { name: "Filter feed" }).click();
  const menu = page.getByRole("group", { name: "Filter by topic" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Markets" }).click();

  // THE functional assertion: the AI-safety story is gone, Markets remains.
  await expect(aiCard).toHaveCount(0);
  await expect(marketsCard).toBeVisible();

  // The funnel button now advertises the active filter for assistive tech.
  await expect(
    page.getByRole("button", { name: "Filtering by Markets" }),
  ).toBeVisible();

  await testInfo.attach("feed-filtered-markets.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  // "All topics" restores the full feed.
  await page.getByRole("button", { name: "Filtering by Markets" }).click();
  const menu2 = page.getByRole("group", { name: "Filter by topic" });
  await expect(menu2).toBeVisible();
  await menu2.getByRole("button", { name: "All topics" }).click();

  await expect(aiCard).toBeVisible();
  await expect(marketsCard).toBeVisible();
});
