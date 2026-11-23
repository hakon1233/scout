import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// A local account (profiles.runs_local) on the fake backend
// (src/lib/hosted-fake.ts, sessionStorage "scout.fake.local"): its feed and
// its own topic's page show the "Local" badge, and a queued run reads
// "Waiting for your Mac". Nothing touches the network.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1") || !/^https?:\/\//.test(url)
      ? route.continue()
      : route.abort();
  });
}

test("a local account shows the Local badge and waits for the Mac", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("scout.fake.local", "1"),
  );

  await page.goto(`${ORIGIN}/app/`);
  await expect(page.getByText("Local", { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });

  await page.goto(`${ORIGIN}/app/topics/?id=power`);
  await page
    .getByRole("button", { name: "Run now" })
    .click({ timeout: 60_000 });
  await expect(page.getByText("Local", { exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for your Mac")).toBeVisible();
});

test("an ordinary account has no Local badge", async ({ page }) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/topics/?id=power`);
  await page
    .getByRole("button", { name: "Run now" })
    .click({ timeout: 60_000 });
  await expect(page.getByText("Waiting to start…")).toBeVisible();
  await expect(page.getByText("Local", { exact: true })).toHaveCount(0);
});
