import { expect, test } from "@playwright/test";

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
      return route.continue();
    }
    return route.abort();
  });
}

test("paired landing/connect entry is replaced by the app and browser Back stays in the app", async ({
  page,
}) => {
  await blockNonLoopback(page);

  await page.goto(`${ORIGIN}/`);
  await page.goto(`${ORIGIN}/app/connect/`);

  await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Connect your agent" }),
  ).toHaveCount(0);

  await page.goBack();

  await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Connect your agent" }),
  ).toHaveCount(0);
});

test("unpaired users can still reach Connect", async ({ page }) => {
  await blockNonLoopback(page);
  await page.route(`${ORIGIN}/healthz`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false }),
    }),
  );
  await page.route(`${ORIGIN}/v0/config`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ token: null }),
    }),
  );

  await page.goto(`${ORIGIN}/app/connect/`);

  await expect(page).toHaveURL(`${ORIGIN}/app/connect/`);
  await expect(
    page.getByRole("heading", { name: "Connect your agent" }),
  ).toBeVisible();
});
