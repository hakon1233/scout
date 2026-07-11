import { expect, test } from "@playwright/test";

// AIR-399: the main-feed single-story flow (PER-222/223) — the app's highest-
// traffic interaction and, until now, the one with no e2e coverage. Opening a
// story from the current edition must collapse ALL surrounding page chrome
// (brief header, coverage/companion banners, the history pager, the sibling
// cards) and render ONLY the focused story; both the in-app "← Back to feed"
// button and the browser Back button must restore the feed. This drives the real
// exported app served by the packed @scout/agent artifact, fully offline: the
// brief is seeded into localStorage (scout.lastBrief.v1) so no companion run and
// no paid scrape is involved.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const SETTINGS_KEY = "scout.settings.v1";
const BRIEF_KEY = "scout.lastBrief.v1";

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
    // Source images + favicons are external — abort them so the feed degrades to
    // its text-only form (FeedImage onError) and nothing leaves the loopback.
    return route.abort();
  });
}

// A two-story daily brief. Headlines derive from the `domain — Title` citation
// label (FeedView.deriveHeadline strips the leading domain). Both topics are
// "covered" so no coverage banner competes with the chrome we assert on.
// publishedAt orders the feed newest-first → Energy card leads.
const SETTINGS = {
  name: "",
  interests: [
    { id: "int_energy", topic: "Energy" },
    { id: "int_ai_safety", topic: "AI safety" },
  ],
};

const BRIEF = {
  id: "brief_air399_1",
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
      body: "Lab cells hit **2x** the density of today's packs.\n\nMass production is still years out, the team cautions.",
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

const LEAD_HEADLINE = "Quantum batteries double in density";
const OTHER_HEADLINE = "A new alignment benchmark lands";

test("opening a story collapses the feed to that single story", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await seedFeed(page);

  await page.goto(`${ORIGIN}/app/`);

  // Feed view: the brief header and both story cards are present.
  const briefHeader = page.getByRole("heading", { name: /Your brief —/ });
  await expect(briefHeader).toBeVisible();
  await expect(
    page.getByRole("heading", { name: LEAD_HEADLINE }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: OTHER_HEADLINE }),
  ).toBeVisible();

  // Open the lead story.
  await page.getByRole("heading", { name: LEAD_HEADLINE }).click();

  // Single-story mode (PER-222): the focused story carries its own headline +
  // source link and a way back…
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Read the full story at example\.com/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Mass production is still years out"),
  ).toBeVisible();

  // …and EVERYTHING else collapses: the brief header and the sibling card are
  // gone (FeedView swaps grid→detail; the page drops its surrounding chrome) —
  // only the one focused story remains.
  await expect(briefHeader).toHaveCount(0);
  await expect(page.getByRole("heading", { name: OTHER_HEADLINE })).toHaveCount(
    0,
  );
});

test("the in-app Back button restores the full feed", async ({ page }) => {
  await blockNonLoopback(page);
  await seedFeed(page);
  await page.goto(`${ORIGIN}/app/`);

  await page.getByRole("heading", { name: LEAD_HEADLINE }).click();
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "← Back to feed" }).click();

  // Both cards and the brief header are back; the detail is gone.
  await expect(
    page.getByRole("heading", { name: /Your brief —/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: LEAD_HEADLINE }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: OTHER_HEADLINE }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toHaveCount(0);
});

test("the browser Back button closes the story detail (popstate)", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await seedFeed(page);
  await page.goto(`${ORIGIN}/app/`);

  // openDetail() pushes one history entry, so browser Back pops it and the
  // popstate listener closes the detail in-place (PER-206/209) — no route change,
  // we stay on /app/.
  await page.getByRole("heading", { name: LEAD_HEADLINE }).click();
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toBeVisible();

  await page.goBack();

  await expect(
    page.getByRole("heading", { name: /Your brief —/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: OTHER_HEADLINE }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/?$/);
});
