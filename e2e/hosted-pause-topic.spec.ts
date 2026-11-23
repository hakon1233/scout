import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// Pause and Resume in Settings on the fake backend (src/lib/hosted-fake.ts,
// the Free plan: 3 weekly slots, no daily one). Pausing frees a slot at once;
// Resume takes one back, and with none free it says so and stays paused.
// Every move is client-side, so the fake keeps its state.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const POWER = "Nordic power prices and the NO3 area";
const LLAMA = "r/LocalLLaMA: new open models and benchmarks";
const RUST = "Rust releases and the async working group";
const WORD = "Norwegian word of the day";

const weekly = (page: Page) =>
  page.getByText("Weekly topics", { exact: true }).locator("xpath=../..");

const topicRow = (page: Page, topic: string) =>
  page
    .getByRole("region", { name: "Topics" })
    .getByText(topic, { exact: true })
    .locator("xpath=../..");

async function press(page: Page, verb: "Pause" | "Resume", topic: string) {
  await page.getByRole("button", { name: `${verb} ${topic}` }).click();
}

async function goTo(page: Page, name: "Settings" | "Topics") {
  await page.getByRole("button", { name: "Menu" }).first().click();
  await page.getByRole("link", { name }).click();
}

test("pausing in Settings frees a slot; resuming with none free says so", async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.goto(`${ORIGIN}/app/settings/`);
  await expect(weekly(page)).toContainText("1 of 3", { timeout: 60_000 });

  // Pausing frees the weekly slot at once.
  await press(page, "Pause", RUST);
  await expect(topicRow(page, RUST)).toContainText("Paused");
  await expect(weekly(page)).toContainText("0 of 3");
  await press(page, "Resume", RUST);
  await expect(topicRow(page, RUST)).toContainText("Weekly");

  // A daily topic resumes weekly: Free has no daily slot.
  for (const topic of [POWER, LLAMA]) {
    await press(page, "Pause", topic);
    await expect(topicRow(page, topic)).toContainText("Paused");
    await press(page, "Resume", topic);
    await expect(topicRow(page, topic)).toContainText("Weekly");
  }
  await expect(weekly(page)).toContainText("3 of 3");

  // A new topic with every slot taken stays paused.
  await goTo(page, "Topics");
  await page.getByRole("button", { name: "+ New" }).click();
  const box = page.getByRole("textbox", { name: "Message Scout" });
  await box.fill("a Norwegian word of the day, explained in English");
  await box.press("Enter");
  const card = page.getByRole("alertdialog", {
    name: new RegExp(`New topic · ${WORD}`),
  });
  await expect(card.getByText(/^Paused · Private/)).toBeVisible({
    timeout: 30_000,
  });
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // Resuming it with no free slot: a plain message, and it stays paused.
  await goTo(page, "Settings");
  await press(page, "Resume", WORD);
  await expect(topicRow(page, WORD).getByRole("alert")).toHaveText(
    "No free weekly slot. Pause another topic or upgrade.",
  );
  await expect(
    page.getByRole("button", { name: `Resume ${WORD}` }),
  ).toBeVisible();
  await expect(weekly(page)).toContainText("3 of 3");

  // Pause another, and the slot is there to take.
  await press(page, "Pause", RUST);
  await expect(weekly(page)).toContainText("2 of 3");
  await press(page, "Resume", WORD);
  await expect(topicRow(page, WORD)).toContainText("Weekly");
  await expect(weekly(page)).toContainText("3 of 3");
  await expect(
    page.getByRole("button", { name: `Resume ${RUST}` }),
  ).toBeVisible();
});
