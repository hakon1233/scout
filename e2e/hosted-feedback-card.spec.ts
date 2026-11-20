import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// The setup chat's feedback card on the fake backend (src/lib/hosted-fake.ts):
// a bug report becomes a "Send feedback" card with the note as written, and
// Confirm sends it. Nothing touches the network.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1") || !/^https?:\/\//.test(url)
      ? route.continue()
      : route.abort();
  });
}

test("a bug report waits on a Send feedback card until Confirm", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/topics/?new=1`);
  const box = page.getByRole("textbox", { name: "Message Scout" });
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill("The feed is blank on my phone, looks like a bug");
  await box.press("Enter");

  const card = page.getByRole("alertdialog", {
    name: /Send feedback · Feed is blank on a phone/,
  });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(
    card.getByText("The feed is blank on my phone, looks like a bug"),
  ).toBeVisible();
  await expect(card.getByText("Don’t include personal details.")).toBeVisible();
  if (process.env.SCOUT_SHOTS)
    await card.screenshot({ path: `${process.env.SCOUT_SHOTS}/card.png` });

  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Sent to the Scout team").first()).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
