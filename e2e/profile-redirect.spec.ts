import { expect, test } from "@playwright/test";
import { PORT } from "./port";

const ORIGIN = `http://127.0.0.1:${PORT}`;

// The legacy `/app/profile` index forwards to `/app/settings`; both legacy
// redirects use replace(), so Back skips them.
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
});

for (const { from, to, trap } of [
  { from: "/app/profile/", to: "/app/settings/", trap: /\/app\/profile\b/ },
  { from: "/app/chat/", to: "/app/interests/", trap: /\/app\/chat\b/ },
]) {
  test(`legacy ${from} uses replace(), so browser Back does not re-trap on it`, async ({
    page,
  }) => {
    // For the paired companion the landing route resolves to the app home,
    // which gives Back a real prior entry to return to.
    await page.goto(`${ORIGIN}/`);
    await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
    await page.goto(`${ORIGIN}${from}`);
    await expect(page).toHaveURL(`${ORIGIN}${to}`, { timeout: 15_000 });

    await page.goBack();
    await expect(page).not.toHaveURL(trap);
    await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
  });
}
