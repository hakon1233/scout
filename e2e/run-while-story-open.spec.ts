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
//
// AIR-744: `generatedAt` must be set in the FUTURE, not just "recent" — this
// suite shares one companion process across all specs (workers:1), and
// src/app/app/page.tsx's mount effect fetches the companion's real
// last-ready-brief and silently adopts it over whatever's cached locally
// whenever it's newer (`prev.generatedAt >= latest.generatedAt`). Several
// earlier-sorting specs (e.g. liked-live-flow.spec.ts) run a REAL synthesis
// through the offline stub, which writes a genuinely "just now"-dated brief
// to the companion. A seed dated in the past (this file originally used
// 2026-06-25, always older than "today") loses that comparison and gets
// silently replaced by the real brief — which is exactly what broke this
// test under full-suite load: it seeded "Quantum batteries...", found the
// real stub's canonical "Alignment update" story instead, and timed out
// waiting for a heading that was never going to render. Same shared-state
// contamination class as this suite's other companion-timing gotchas.
const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const SETTINGS = {
  name: "",
  interests: [{ id: "int_energy", topic: "Energy" }],
};

const BRIEF = {
  id: "brief_air743_1",
  generatedAt: "2099-01-01T00:00:00.000Z",
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
