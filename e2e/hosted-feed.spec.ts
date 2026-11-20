import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// The hosted app against its in-memory fake backend (src/lib/hosted-fake.ts):
// the feed shows the brief, a topic opens its own page, and its brief
// settings save.

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

test("hosted feed on the fake backend: brief, topic page, brief settings", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/`);
  await expect(
    page.getByRole("button", {
      name: "NO3 day-ahead price hits 142 øre/kWh",
    }),
  ).toBeVisible({ timeout: 60_000 });

  await page.goto(`${ORIGIN}/app/topics/`);
  await page
    .getByRole("link", { name: "Nordic power prices and the NO3 area" })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Nordic power prices and the NO3 area",
    }),
  ).toBeVisible({ timeout: 30_000 });
  // Only this topic's stories.
  await expect(
    page.getByRole("button", {
      name: "Statnett expects imports on cold weekdays",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /llama\.cpp server/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Notify me about Nordic power prices and the NO3 area",
    }),
  ).toHaveAttribute("aria-pressed", "false");

  const length = page.getByRole("radiogroup", { name: "Brief length" });
  await length.getByRole("radio", { name: "Long" }).click();
  await expect(page.getByText("Saved. The next brief uses it.")).toBeVisible();
  await expect(length.getByRole("radio", { name: "Long" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
