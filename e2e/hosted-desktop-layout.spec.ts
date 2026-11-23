import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// Desktop layout on the hosted app (fake backend, src/lib/hosted-fake.ts): from
// 1024 px the main destinations sit in a top nav on the reading column's edges,
// the column stays 680 px, and nothing scrolls sideways. The phone layout keeps
// only the menu button. The frame lives in src/components/shell/AppShell.tsx.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const DESTINATIONS = ["Brief", "Topics", "Browse", "Settings"];

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1") || !/^https?:\/\//.test(url)
      ? route.continue()
      : route.abort();
  });
}

async function open(page: Page, path: string) {
  await page.goto(`${ORIGIN}${path}`);
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 60_000 });
}

/** The reading column's box and whether the page scrolls sideways. */
function frame(page: Page) {
  return page.evaluate(() => {
    const col = document.querySelector("main > div")!.getBoundingClientRect();
    return {
      left: Math.round(col.left),
      right: Math.round(col.right),
      width: Math.round(col.width),
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

for (const width of [1024, 1280, 1440, 1920]) {
  test(`at ${width} px the destinations sit on the reading column`, async ({
    page,
  }) => {
    await blockNonLoopback(page);
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/app/", "/app/topics/", "/app/settings/"]) {
      await open(page, path);
      const nav = page.getByRole("navigation", { name: "Main" });
      for (const name of DESTINATIONS)
        await expect(nav.getByRole("link", { name }), path).toBeVisible();
      const col = await frame(page);
      expect(col, path).toMatchObject({ width: 680, sideways: false });
      // The bar starts and ends on the column's edges, not the window's.
      const home = await page
        .getByRole("link", { name: "Scout home" })
        .boundingBox();
      const menu = await page
        .getByRole("button", { name: "Menu" })
        .boundingBox();
      expect(Math.round(home!.x), path).toBe(col.left);
      expect(Math.round(menu!.x + menu!.width), path).toBe(col.right);
    }
    await expect(
      page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("aria-current", "page");
  });
}

test("at 390 px the phone keeps only the menu button", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/app/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  expect((await frame(page)).sideways).toBe(false);
});

test("at 768 px nothing scrolls sideways", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 768, height: 900 });
  for (const path of [
    "/app/",
    "/app/topics/?id=power",
    "/i/?s=rust-releases",
  ]) {
    await open(page, path);
    expect((await frame(page)).sideways, path).toBe(false);
  }
});

test("a public topic page uses the app's column", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/app/");
  const app = await frame(page);
  await open(page, "/i/?s=rust-releases");
  expect(await frame(page)).toEqual(app);
});

test("a topic page's Run now ends on the column edge", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "/app/topics/?id=rust");
  const col = await frame(page);
  const run = await page.getByRole("button", { name: "Run now" }).boundingBox();
  expect(Math.round(run!.x + run!.width)).toBe(col.right);
});
