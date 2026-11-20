import { expect, test } from "@playwright/test";
import { PORT } from "./port";

const ORIGIN = `http://127.0.0.1:${PORT}`;

// The legacy `/app/chat` route forwards to `/app/interests` with replace(),
// so Back skips it. (`/app/profile` is the Profile page now, not a redirect.)
for (const { from, to, trap } of [
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
