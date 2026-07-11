import { expect, test } from "@playwright/test";

// AIR-414: the like/save ROUND-TRIP from the main feed — the genuine user
// journey that, until now, had no e2e coverage. liked-feed.spec.ts seeds the
// likes store directly via addInitScript and only exercises the /app/liked
// page in isolation; it never clicks the heart on a real feed card. This spec
// closes that gap end-to-end: it renders the actual feed, clicks the LikeButton
// on a story card (the real `toggleLike` write path), then proves the saved
// story surfaces in the Liked feed, persists across a full reload, and — the
// reverse direction — that unliking from the feed clears it again.
//
// Drives the real exported app served by the packed @scout/agent artifact,
// fully offline: the brief is seeded into localStorage (scout.lastBrief.v1) so
// no companion run and NO paid scrape is involved. The likes store is NOT
// seeded for the round-trip — the UI click is what must write it.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";
const LIKES_KEY = "scout.likes.v1";

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
      return route.continue();
    }
    // Source images + favicons are external — abort them so the feed degrades
    // to its text-only form (FeedImage onError) and nothing leaves loopback.
    return route.abort();
  });
}

// A two-story daily brief. Headlines derive from the `domain — Title` citation
// label (FeedView.deriveHeadline strips the leading domain). publishedAt orders
// the feed newest-first → the Energy card leads.
const SETTINGS = {
  name: "",
  interests: [
    { id: "int_energy", topic: "Energy" },
    { id: "int_ai_safety", topic: "AI safety" },
  ],
};

const BRIEF = {
  id: "brief_air414_1",
  generatedAt: "2026-06-25T09:00:00.000Z",
  kind: "daily",
  interests: ["Energy", "AI safety"],
  topics: [
    { topic: "Energy", status: "covered" },
    { topic: "AI safety", status: "covered" },
  ],
  markdown:
    "## Energy\n\nQuantum batteries double in density.\n\n## AI safety\n\nA new alignment benchmark lands.",
  articles: [
    {
      id: "story_energy_1",
      title: "example.com — Quantum batteries double in density",
      url: "https://example.com/quantum-batteries",
      interest: "Energy",
      source: "example.com",
      text: "Researchers report a doubling of cell energy density.",
      body: "Lab cells hit **2x** the density of today's packs.",
      publishedAt: "2026-06-25T08:00:00.000Z",
    },
    {
      id: "story_ai_1",
      title: "openai.com — A new alignment benchmark lands",
      url: "https://openai.com/alignment-bench",
      interest: "AI safety",
      source: "openai.com",
      text: "A fresh benchmark probes model deception under pressure.",
      body: "The suite stress-tests honesty across adversarial prompts.",
      publishedAt: "2026-06-24T08:00:00.000Z",
    },
  ],
};

const LEAD_HEADLINE = "Quantum batteries double in density";
// canonicalUrl(url) — the store key the like is written under (no hash/query,
// no trailing slash). The article URL already canonicalises to itself.
const LEAD_KEY = "https://example.com/quantum-batteries";

async function seedFeed(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ settingsKey, briefKey, settings, brief }) => {
      window.localStorage.setItem(settingsKey, JSON.stringify(settings));
      window.localStorage.setItem(briefKey, JSON.stringify(brief));
    },
    {
      settingsKey: SETTINGS_KEY,
      briefKey: BRIEF_KEY,
      settings: SETTINGS,
      brief: BRIEF,
    },
  );
}

// The lead story's like control, scoped to its own card so the sibling card's
// heart can never be clicked by accident.
function leadHeart(
  page: import("@playwright/test").Page,
  name: "Save to liked stories" | "Remove from liked stories",
) {
  return page
    .locator("div.group", {
      has: page.getByRole("heading", { name: LEAD_HEADLINE }),
    })
    .getByRole("button", { name });
}

test("saving a story from the feed surfaces it in the Liked feed and persists", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await seedFeed(page);

  await page.goto(`${ORIGIN}/app/`);

  // The feed renders the lead card; its heart starts in the unsaved state.
  await expect(
    page.getByRole("heading", { name: LEAD_HEADLINE }),
  ).toBeVisible();
  const save = leadHeart(page, "Save to liked stories");
  await expect(save).toHaveAttribute("aria-pressed", "false");

  // Click the real LikeButton → toggleLike() writes the store and the control
  // flips reactively (useIsLiked → aria-pressed/label), no reload.
  await save.click();
  const saved = leadHeart(page, "Remove from liked stories");
  await expect(saved).toHaveAttribute("aria-pressed", "true");

  // The store was actually written (not just the DOM), keyed on canonical URL,
  // with the card's display snapshot.
  const liked = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, LIKES_KEY);
  expect(liked?.likes?.[LEAD_KEY]).toMatchObject({
    key: LEAD_KEY,
    url: LEAD_KEY,
    headline: LEAD_HEADLINE,
    source: "example.com",
    topic: "Energy",
  });
  expect(typeof liked.likes[LEAD_KEY].likedAt).toBe("string");

  // Navigate to the Liked feed via the real top-bar entry point.
  await page.getByRole("link", { name: "Liked stories" }).click();
  await expect(page).toHaveURL(/\/app\/liked\/?$/);

  // The story the user saved from the feed is now in the Liked feed.
  await expect(
    page.getByRole("heading", { name: LEAD_HEADLINE }),
  ).toBeVisible();
  // The non-leading story was never liked — it must not appear here.
  await expect(
    page.getByRole("heading", { name: "A new alignment benchmark lands" }),
  ).toHaveCount(0);

  // Survives a full reload — real persistence, not session state.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: LEAD_HEADLINE }),
  ).toBeVisible();
});

test("unliking from the feed card clears it from the Liked feed", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await seedFeed(page);
  // Seed an existing like for the lead story, ONLY on first load (init scripts
  // re-run on every navigation incl. the post-unlike visit to /app/liked — an
  // unconditional seed would resurrect it and defeat the check).
  await page.addInitScript(
    ({ key, leadKey, headline }) => {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            likes: {
              [leadKey]: {
                key: leadKey,
                url: leadKey,
                headline,
                source: "example.com",
                topic: "Energy",
                publishedAt: "2026-06-25T08:00:00.000Z",
                likedAt: "2026-06-25T09:30:00.000Z",
              },
            },
          }),
        );
      }
    },
    { key: LIKES_KEY, leadKey: LEAD_KEY, headline: LEAD_HEADLINE },
  );

  await page.goto(`${ORIGIN}/app/`);

  // The pre-existing like is reflected on the feed card — the heart reads as
  // already saved, proving the store drives the feed control too.
  const saved = leadHeart(page, "Remove from liked stories");
  await expect(saved).toHaveAttribute("aria-pressed", "true");

  // Unlike from the feed card.
  await saved.click();
  await expect(leadHeart(page, "Save to liked stories")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // The store was emptied.
  const likes = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw).likes : null;
  }, LIKES_KEY);
  expect(likes).toEqual({});

  // The Liked feed now shows the empty state — the unlike propagated.
  await page.goto(`${ORIGIN}/app/liked/`);
  await expect(page.getByRole("heading", { name: LEAD_HEADLINE })).toHaveCount(
    0,
  );
  await expect(page.getByText("No liked stories yet")).toBeVisible();
});
