import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The legacy `/app/profile` index is a "Profile moved" stub: it mounts, then
// `router.replace("/app/settings")` immediately forwards the user on. The
// existing suite covers the standalone `/app/profile/interest` scope page
// (profile-interest-scope.spec.ts) but never the index redirect itself.
//
// Two user-facing guarantees this guards:
//   1. landing on the old `/app/profile` URL (a stale bookmark/link) does not
//      dead-end on the stub — it forwards to the live Settings page and that
//      page actually renders, and
//   2. it uses replace(), not push() — so the browser Back button does NOT
//      bounce the user straight back onto /app/profile (a redirect back-trap),
//      it returns to wherever they came from.
// Fully offline against the served static export; no companion data, no scrape.
test.describe("legacy /app/profile redirect", () => {
  test("forwards to /app/settings and the Settings page renders", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/profile/`);

    // The replace lands on Settings…
    await expect(page).toHaveURL(`${ORIGIN}/app/settings/`, {
      timeout: 15_000,
    });
    // …and Settings is genuinely mounted, not just a URL swap: its h1 plus a
    // settings-only section heading are both on screen.
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Scheduled briefs" }),
    ).toBeVisible();

    // The "Profile moved" stub itself must not linger behind the redirect.
    await expect(
      page.getByRole("heading", { name: "Choose a profile page" }),
    ).toBeHidden();
  });

  test("uses replace(), so browser Back does not re-trap on /app/profile", async ({
    page,
  }) => {
    // Arrive from the public landing route first so there is a real prior
    // history entry to fall back to. For the paired companion the landing route
    // itself resolves to the app home (/app/), so that is the entry Back
    // returns to.
    await page.goto(`${ORIGIN}/`);
    await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
    await page.goto(`${ORIGIN}/app/profile/`);

    await expect(page).toHaveURL(`${ORIGIN}/app/settings/`, {
      timeout: 15_000,
    });

    // THE assertion: Back skips the stub entirely (replace consumed its entry)
    // and returns to the app home — it does NOT bounce to /app/profile and
    // re-fire the forward into a loop.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/app\/profile\b/);
    await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
  });
});
