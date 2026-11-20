import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// Fixes from testing the hosted site, checked on the fake backend
// (src/lib/hosted-fake.ts): no hydration errors, legal links at sign-in, back
// links that fit a signed-out reader, a title per screen, a story that lives
// in the URL, a bell that turns push on by itself, and Run now on a
// topic's page.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const STORY = "NO3 day-ahead price hits 142 øre/kWh";
const TOPIC = "Nordic power prices and the NO3 area";

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost") ||
      !/^https?:\/\//.test(url)
    ) {
      return route.continue();
    }
    return route.abort();
  });
}

test("Settings and Profile load without a hydration error", async ({
  page,
}) => {
  await blockNonLoopback(page);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of ["/app/settings/", "/app/profile/"]) {
    await page.goto(`${ORIGIN}${path}`);
    await expect(page.locator("h1")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
  }
  expect(errors.filter((e) => /hydrat|#418/i.test(e))).toEqual([]);
});

test("sign-in names the Terms and Privacy policy; back links fit a signed-out reader", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("scout.fake.signedOut", "1"),
  );
  await page.goto(`${ORIGIN}/app/signin/`);
  await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    /\/app\/terms\/?$/,
    { timeout: 60_000 },
  );
  await expect(
    page.getByRole("link", { name: "Privacy policy" }),
  ).toHaveAttribute("href", /\/app\/privacy\/?$/);

  await page.goto(`${ORIGIN}/app/terms/`);
  await expect(page.getByRole("link", { name: "‹ Sign in" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`${ORIGIN}/app/browse/`);
  await expect(page.getByRole("link", { name: "‹ Home" })).toBeVisible({
    timeout: 30_000,
  });
});

test("each screen names itself in the tab title", async ({ page }) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/browse/`);
  await expect(page).toHaveTitle("Browse · Scout", { timeout: 60_000 });
  await page.goto(`${ORIGIN}/app/settings/`);
  await expect(page).toHaveTitle("Settings · Scout");
  await page.goto(`${ORIGIN}/app/settings/delete/`);
  await expect(page).toHaveTitle("Delete account · Scout");
});

test("an open story is in the URL: reload keeps it, Back closes it", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/`);
  await page.getByRole("button", { name: STORY }).click({ timeout: 60_000 });
  const back = page.getByRole("button", { name: "← Back to feed" });
  // The story's own article: the brief's article around it also holds Back,
  // and its header (with its own "Written by AI") lingers for a frame.
  const detail = back.locator("xpath=ancestor::article[1]");
  await expect(page).toHaveURL(/[?&]story=/);
  await expect(detail.getByText("Written by AI")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: STORY }),
  ).toBeVisible({ timeout: 60_000 });

  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]story=/);
  await expect(back).toHaveCount(0);
});

test("a topic's bell turns on even while push is off on this device", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"], { origin: ORIGIN });
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/topics/`);
  await page.getByRole("link", { name: TOPIC }).click({ timeout: 60_000 });
  const bell = page.getByRole("button", { name: `Notify me about ${TOPIC}` });
  await expect(bell).toHaveAttribute("aria-pressed", "false", {
    timeout: 30_000,
  });
  await bell.click();
  await expect(bell).toHaveAttribute("aria-pressed", "true");
});

test("a topic's page runs it now and shows the run until it ends", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/topics/?id=power`);
  const run = page.getByRole("button", { name: "Run now" });
  await run.click({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Running" })).toBeVisible();
  await expect(page.getByText("Waiting to start…")).toBeVisible();
  await expect(run).toBeVisible({ timeout: 15_000 });
});
