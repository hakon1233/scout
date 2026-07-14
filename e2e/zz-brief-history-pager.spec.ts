import { expect, test, type Page } from "@playwright/test";

// The "previous briefs" pager (src/components/BriefHistory.tsx, PER-219 AC6)
// pages the companion's rolling history 3-at-a-time via GET
// /v0/briefs?limit=&offset= and has its own single-story isolation mode
// (PER-223: drilling into a HISTORY edition's story hides every other
// edition and the pager footer). No existing spec drives any of this —
// weekly-brief.spec.ts and liked-live-flow.spec.ts only ever generate ONE or
// TWO editions in passing, never enough to exercise "Load older briefs" or
// the isolation mode. This spec builds up 5 MORE editions (offset math
// needs more than PAGE_SIZE=3 history items to ever show the button)
// entirely through the real "Run now" UI control against the offline stub,
// then drives the pager itself.
//
// Offline/deterministic like the rest of the suite: same-origin token
// auto-adoption (no paste), the claude shell-out stubbed, every non-loopback
// request blocked.
//
// `zz-` prefix is deliberate, not cosmetic: PUT /v0/interests rejects an
// empty list by design (min 1 interest — packages/agent/src/routes/
// interests.ts), so once this spec posts a real interest to the shared
// companion (workers:1 — one companion process for the whole suite) there is
// no way to hand it back pristine for a spec that runs after. Every other
// spec that posts real interests (liked-live-flow/weekly-brief/zero-prompt)
// already relies on the same implicit ordering constraint by sorting late
// alphabetically; a handful of earlier specs (e.g. chat-actions.spec.ts)
// depend on an interest-free companion and would silently adopt whatever
// this spec leaves behind otherwise. This filename sorts after all of them.
//
// Running last also means the companion may ALREADY hold history from
// weekly-brief/liked-live-flow/zero-prompt by the time this test starts —
// every assertion below is written relative to whatever's already there
// (never a hardcoded absolute count), so it holds regardless of what ran
// before it.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function blockNonLoopback(page: Page) {
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
// land. Each call persists one daily brief into the companion's rolling
// history (same helper shape as weekly-brief.spec.ts's runDailyBrief).
async function runDailyBrief(page: Page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  const runNow = page.getByRole("button", { name: "Run now" });
  await expect(runNow).toBeEnabled({ timeout: 15_000 });
  await runNow.click();
  await expect(
    page.getByRole("button", { name: /Alignment update/ }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

test("brief history pager: pagination and single-story isolation (PER-219 AC6, PER-223)", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await blockNonLoopback(page);
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
  await expect(
    page.getByRole("link", { name: /Pair companion/i }),
  ).toHaveCount(0);

  // 5 MORE editions on top of whatever's already there. PAGE_SIZE=3, so 5
  // alone (1 current + 4 history) is already enough to guarantee "Load
  // older briefs" shows and a second page load is exercisable, regardless
  // of any pre-existing baseline.
  for (let i = 0; i < 5; i++) {
    await runDailyBrief(page);
  }

  const openButtons = page.getByRole("button", { name: /Alignment update/ });
  const loadMore = page.getByRole("button", { name: "Load older briefs" });

  await expect(loadMore).toBeVisible();
  let shown = await openButtons.count();
  // 1 current + at least PAGE_SIZE (3) history editions on the first page.
  expect(shown).toBeGreaterThanOrEqual(4);

  // Exhaust pagination: each click must strictly grow the rendered set
  // until the companion's own history is exhausted and the button drops.
  // Bounded so a genuine regression (button never disappearing) fails
  // loudly instead of hanging.
  for (let guard = 0; guard < 10 && (await loadMore.count()) > 0; guard++) {
    await loadMore.click();
    await expect(async () => {
      expect(await openButtons.count()).toBeGreaterThan(shown);
    }).toPass({ timeout: 5_000 });
    shown = await openButtons.count();
  }
  await expect(loadMore).toHaveCount(0);
  const finalCount = shown;

  await testInfo.attach("history-fully-loaded", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  // Drill into a HISTORY edition's story (nth(1) = never the current
  // edition, which is always nth(0)) — PER-223 single-story isolation.
  await openButtons.nth(1).click();

  await expect(
    page.getByRole("button", { name: "← Back to feed" }),
  ).toBeVisible();
  // The isolated story renders open (its headline is now an h1, not an
  // open-button) — every OTHER edition's open-button, and the pager footer,
  // must be gone entirely.
  await expect(
    page.getByRole("heading", { name: "Alignment update", level: 1 }),
  ).toBeVisible();
  await expect(openButtons).toHaveCount(0);
  await expect(page.getByText(/Showing \d+ previous briefs/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Manage interests" }),
  ).toHaveCount(0);

  // Back out: every edition and the pager footer return, exactly as before.
  await page.getByRole("button", { name: "← Back to feed" }).click();
  await expect(openButtons).toHaveCount(finalCount);
  await expect(page.getByText(/Showing \d+ previous briefs/)).toBeVisible();

  // "Manage interests" is a real navigation, not a dead label.
  await page.getByRole("button", { name: "Manage interests" }).click();
  await expect(page).toHaveURL(/\/app\/interests\/?$/);
});
