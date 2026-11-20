import { expect, test } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// "Lots of pushes, mute some?" on the hosted app's fake backend
// (src/lib/hosted-fake.ts, where a daily topic with its bell on pushes 7 times
// a week): two bells on make lots, and the feed offers to mute each topic with
// one tap, through the same bell.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const POWER = "Nordic power prices and the NO3 area";
const LLAMA = "r/LocalLLaMA: new open models and benchmarks";

test("lots of pushes: the feed offers to mute each topic, and muting turns its bell off", async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.goto(`${ORIGIN}/app/settings/`);
  for (const topic of [POWER, LLAMA]) {
    const bell = page.getByRole("button", { name: `Notify me about ${topic}` });
    await bell.click({ timeout: 60_000 });
    await expect(bell).toHaveAttribute("aria-pressed", "true");
  }

  // Client-side, so the fake keeps the bells.
  await page.getByRole("link", { name: "Scout home" }).click();
  const card = page.getByRole("region", { name: "Notices" });
  await expect(card.getByText("You got 14 pushes this week.")).toBeVisible({
    timeout: 30_000,
  });
  await card.getByRole("button", { name: `Mute ${POWER}` }).click();
  await expect(
    card.getByRole("button", { name: `Undo mute ${POWER}` }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).first().click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByRole("button", { name: `Notify me about ${POWER}` }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: `Notify me about ${LLAMA}` }),
  ).toHaveAttribute("aria-pressed", "true");
});
