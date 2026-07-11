import { expect, test } from "@playwright/test";

// AIR-229 (Browser QA pass) — end-to-end like flow driven entirely through the
// real UI, against a freshly GENERATED brief.
//
// The existing liked-feed.spec.ts seeds `scout.likes.v1` directly and asserts
// the Liked feed renders/persists/unlikes a pre-baked store. What no committed
// test exercises is the WRITE side of the contract: clicking the heart on a live
// feed card → the snapshot the feed captures (likeInputFor) → the store key
// (canonicalUrl) → the Liked feed READING it back. A keying or snapshot-shape
// mismatch between FeedView's writer and LikedPage's reader would pass every
// seeded test and still ship a feature where "Save" silently drops the story.
//
// This drives the whole loop with no seeded store, offline and deterministic
// (stub claude via SCOUT_CLAUDE_BIN, non-loopback requests blocked):
//   run brief → like a card → top-bar heart → story appears in Liked →
//   survives reload → unlike in place → empty state → survives reload.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Belt-and-suspenders offline guard (same shape as the sibling specs): abort any
// request that isn't to the loopback companion, so the core loop never depends
// on a remote (e.g. the google favicon the Liked card pulls).
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

test("like a freshly-generated story → it appears in the Liked feed, persists, and unlikes in place", async ({
  page,
}, testInfo) => {
  test.skip(
    !!process.env.CI,
    "AIR-642: stub-claude.mjs crashes deterministically in CI (ReferenceError: stdin is not defined) — test-infra bug, passes locally, tracked for root-cause",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await blockNonLoopback(page);

  // Same precondition as zero-prompt.spec: the in-page keyword setup form is
  // gone (PER-188), so seed the post-setup interest set directly in the exact
  // shape saveSettings writes. This test is about the like flow, not setup.
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

  // Companion ready (same-origin auto-adoption): the pairing prompt is gone.
  await expect(page.getByRole("link", { name: /Pair companion/i })).toHaveCount(
    0,
  );

  // Fire the run from the profile menu (PER-219) and wait for the feed card.
  await page.getByRole("button", { name: "Open settings" }).click();
  const runNow = page.getByRole("menuitem", { name: "Run now" });
  await expect(runNow).toBeEnabled({ timeout: 15_000 });
  await runNow.click();

  // The stub brief's `## AI safety` story renders as a card whose headline is the
  // citation title "Alignment update". The card's open-button carries that text.
  // `.first()` scopes to the CURRENT edition (rendered above the BriefHistory
  // pager): the companion's brief history is shared across tests (HOME resets
  // only at server boot), so an earlier brief-generating test can leave a
  // previous edition with the same headline in the pager below.
  const openButton = page
    .getByRole("button", { name: /Alignment update/ })
    .first();
  await expect(openButton).toBeVisible({ timeout: 30_000 });

  // The heart is a SIBLING of the open button inside the card wrapper (a <button>
  // can't nest a <button>), so scope to the wrapper to grab THIS card's heart and
  // not the other story's. Before clicking, it must announce as an unpressed
  // "Save" toggle.
  const card = openButton.locator("xpath=..");
  const saveHeart = card.getByRole("button", {
    name: "Save to liked stories",
  });
  await expect(saveHeart).toHaveAttribute("aria-pressed", "false");

  await saveHeart.click();

  // Optimistic toggle: the same heart flips to the pressed "Remove" state in
  // place (proves the write + useSyncExternalStore re-render path).
  await expect(
    card.getByRole("button", { name: "Remove from liked stories" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Navigate to the Liked feed via the real CEO-locked top-bar heart (the only
  // sanctioned entry point), not a raw goto.
  await page.getByRole("link", { name: "Liked stories" }).click();
  await expect(page).toHaveURL(/\/app\/liked\/?$/);

  // THE write→read assertion: the story the feed captured is now rendered by the
  // Liked page reading it back from the store. Headline (h3) + topic + source all
  // survive the likeInputFor snapshot → canonicalUrl key → useLikedStories path.
  const likedHeading = page.getByRole("heading", {
    name: "Alignment update",
    level: 3,
  });
  await expect(likedHeading).toBeVisible();
  const likedCard = likedHeading.locator("xpath=ancestor::div[1]");
  await expect(likedCard.getByText("AI safety")).toBeVisible();
  await expect(
    likedCard.getByText("example.com", { exact: false }),
  ).toBeVisible();

  // Capture evidence of the populated Liked feed on a green run too.
  await testInfo.attach("liked-feed-populated", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  // Persistence: the like is device-local (localStorage). A full reload of the
  // Liked route must still show it — this is the survive-a-new-session promise.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Alignment update", level: 3 }),
  ).toBeVisible();

  // Unlike in place from the Liked feed: the card's heart removes it, leaving the
  // empty state.
  await page.getByRole("button", { name: "Remove from liked stories" }).click();
  await expect(
    page.getByRole("heading", { name: "Alignment update", level: 3 }),
  ).toHaveCount(0);
  await expect(page.getByText("No liked stories yet")).toBeVisible();

  // The removal also persists across reload — no zombie like resurrected from a
  // stale cache.
  await page.reload();
  await expect(page.getByText("No liked stories yet")).toBeVisible();
});
