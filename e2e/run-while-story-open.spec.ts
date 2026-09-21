import { expect, test, type Page } from "@playwright/test";

// AIR-743 (Bug hunt & fix pass): pressing "Run now" WHILE a single-story detail
// is open must still surface the run's progress panel + skeleton.
//
// The single-story collapse (PER-222/223) hides all page chrome behind
// `storyOpen = todayStoryOpen || historyStoryOpen`. But starting a run unmounts
// the open-story feed (the feed block swaps to `BriefSkeleton` when
// `showSkeleton` is true), and the unmounting `FeedView` never emits
// `onDetailOpenChange(false)` — so `todayStoryOpen`/`historyStoryOpen` stayed
// stuck `true`. The run chrome (progress panel + skeleton), gated on
// `!storyOpen`, was therefore suppressed at the SAME time the feed unmounted,
// leaving a blank content area with zero progress for the entire multi-minute
// run. generate()/runWeekly() now reset the story-open flags on run start.
//
// Fully offline + deterministic: the brief is seeded into localStorage and the
// one POST /v0/interests under test is intercepted (delayed, then 409'd) so no
// synthesis runs — neither the real `claude` nor the e2e stub, and no paid
// scrape is reachable.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const SETTINGS = {
  name: "",
  interests: [{ id: "int_energy", topic: "Energy" }],
};

const BRIEF = {
  id: "brief_air743_1",
  generatedAt: "2026-06-25T09:00:00.000Z",
  kind: "daily",
  interests: ["Energy"],
  topics: [{ topic: "Energy", status: "covered" }],
  markdown: "## Energy\n\nQuantum batteries double in density.",
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
  ],
};

const LEAD_HEADLINE = "Quantum batteries double in density";

async function seedPairedSession(page: Page) {
  await page.addInitScript(
    ({ settings, brief }) => {
      window.localStorage.setItem(
        "scout.settings.v1",
        JSON.stringify(settings),
      );
      window.localStorage.setItem("scout.lastBrief.v1", JSON.stringify(brief));
      window.localStorage.setItem("scout.theme", "light");
    },
    { settings: SETTINGS, brief: BRIEF },
  );
  // The suite shares one companion process, and earlier specs persist real
  // briefs into its state. The app asks the companion for briefs on load and
  // prefers what it returns over the seeded localStorage copy — so without
  // this the page renders another spec's brief and the headline below never
  // appears. Report an empty history so the seeded brief is the only one.
  await page.route(`**/v0/briefs?*`, (route) =>
    route.fulfill({ json: { briefs: [], total: 0 } }),
  );

  await page.goto(`${ORIGIN}/app/`);
  // Same-origin auto-adopt (as zero-prompt.spec.ts): the pairing prompt must be
  // gone before "Run now" is reachable/enabled.
  await expect(
    page.getByRole("link", { name: /Pair companion/i }),
  ).toHaveCount(0);
}

test("Run now while a story detail is open still shows run progress (not a blank feed)", async ({
  page,
}) => {
  // Hold the run "in flight" long enough to assert, then reject. The intercept
  // means the companion never runs a synthesis — no claude/stub spawn, no scrape.
  await page.route(`${ORIGIN}/v0/interests`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 4000));
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "brief in progress" }),
    });
  });

  await seedPairedSession(page);

  // Open the story detail — single-story mode collapses the surrounding chrome.
  await page.getByRole("heading", { name: LEAD_HEADLINE }).click();
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toBeVisible();

  // Fire "Run now" from the profile menu WHILE the story is still open.
  await page.getByRole("button", { name: "Open settings" }).click();
  const runNow = page.getByRole("button", { name: "Run now" });
  await expect(runNow).toBeEnabled({ timeout: 15_000 });
  await runNow.click();

  // Regression: the run's progress panel must render. Before the fix it was
  // suppressed because `storyOpen` stayed true after the open-story feed
  // unmounted, so the whole content area went blank for the run's duration.
  await expect(
    page.getByRole("status", { name: "Agent progress" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Companion is fetching & synthesizing your brief/),
  ).toBeVisible();

  // …and we're no longer stuck in single-story mode.
  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toHaveCount(0);
});
