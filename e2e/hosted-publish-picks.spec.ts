import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// The hosted app on its in-memory fake backend (src/lib/hosted-fake.ts):
// publishing a topic from its page comes back public with tags, a pick on the
// feed can be crossed out, and Browse searches the catalog.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;

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

test("publish a topic from its page: checked, public, with tags", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/topics/?id=llama`);
  const sharing = page.getByRole("radiogroup", { name: "Who can see it" });
  await expect(sharing).toBeVisible({ timeout: 60_000 });
  await expect(sharing.getByRole("radio", { name: "Private" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await sharing.getByRole("radio", { name: "Public" }).click();
  await page.getByRole("button", { name: "Check and publish" }).click();
  await expect(page.getByText("✓ Published")).toBeVisible();
  const tags = page.getByRole("group", {
    name: "Tags for r/LocalLLaMA: new open models and benchmarks",
  });
  for (const tag of ["ai", "open-models"])
    await expect(
      tags.getByRole("button", { name: tag, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Done" }).click();

  await expect(sharing.getByRole("radio", { name: "Public" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText("llama-public")).toBeVisible();
});

test("a pick on the feed can be crossed out", async ({ page }) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/`);
  const cross = page.getByRole("button", {
    name: "Not for me: AI research papers worth reading",
  });
  await expect(cross).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Not for me: / })).toHaveCount(
    3,
  );

  await cross.click();
  await expect(cross).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Not for me: / })).toHaveCount(
    2,
  );
});

test("Browse searches the public topics", async ({ page }) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/browse/`);
  const topics = page.getByRole("region", { name: "Public topics" });
  await expect(
    topics.getByRole("link", { name: "European energy markets" }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Search topics or paste a link").fill("rust");
  await expect(page).toHaveURL(/\?q=rust/);
  const results = page.getByRole("region", { name: "Results" });
  await expect(
    results.getByRole("link", { name: "Rust ecosystem news" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "European energy markets" }),
  ).toHaveCount(0);
});

test("on a phone the brief comes first, picks below it", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ORIGIN}/app/`);
  const picks = page.getByRole("heading", { name: "Picked for you" });
  await expect(picks).toBeVisible({ timeout: 60_000 });
  const brief = page.locator("[data-main]").first();
  const briefTop = (await brief.boundingBox())!.y;
  const picksTop = (await picks.boundingBox())!.y;
  expect(briefTop).toBeLessThan(picksTop);
  // The brief starts in the top third of the first screen.
  expect(briefTop).toBeLessThan(844 / 3);
});

test("Settings marks its groups as the page's main content", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/settings/`);
  await expect(
    page.locator("[data-main]").getByRole("heading", { name: "Appearance" }),
  ).toBeVisible({ timeout: 60_000 });
});
