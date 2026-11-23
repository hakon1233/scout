import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// A topic Scout writes itself ("make") on the fake backend
// (src/lib/hosted-fake.ts): its confirm card says so and names a definite
// schedule (UT-034), and its topic page hides the news-only Stories setting
// (UT-035). Nothing touches the network.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const WORD = "Norwegian word of the day";

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1") || !/^https?:\/\//.test(url)
      ? route.continue()
      : route.abort();
  });
}

test("a make topic's card says Scout writes it, and its page has no Stories setting", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/topics/?new=1`);
  const box = page.getByRole("textbox", { name: "Message Scout" });
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill("a Norwegian word of the day, explained in English");
  await box.press("Enter");

  const card = page.getByRole("alertdialog", {
    name: new RegExp(`New topic · ${WORD}`),
  });
  await expect(card).toBeVisible({ timeout: 30_000 });
  // The fake plan has no daily slot and a free weekly one.
  await expect(
    card.getByText("Weekly · Private · Scout writes this", { exact: true }),
  ).toBeVisible();

  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page
    .getByRole("link", { name: new RegExp(WORD) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: WORD })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Scout writes this/)).toBeVisible();
  await expect(page.getByLabel("Brief length")).toBeVisible();
  await expect(page.getByLabel("How many stories")).toHaveCount(0);
});
