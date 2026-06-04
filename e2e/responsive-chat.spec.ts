import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

test.describe("responsive interest chat", () => {
  test("desktop interests renders the real chat dock alongside interests", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    await expect(
      page.getByRole("heading", { name: "Interests" }).first(),
    ).toBeVisible();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
    await expect(page.getByLabel("Message Scout")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open chat" })).toHaveCount(0);

    await page.getByRole("button", { name: "Refine" }).first().click();
    await expect(page).toHaveURL(/\/app\/interests/);
    await expect(page.getByLabel("Message Scout")).toHaveAttribute(
      "placeholder",
      /AI policy & regulation/,
    );
  });

  test("mobile keeps chat as its own page instead of a side panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    await expect(page.getByLabel("Chat with Scout")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open chat" })).toBeVisible();

    await page.getByRole("link", { name: "Open chat" }).click();
    await expect(page).toHaveURL(/\/app\/chat/);
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
  });
});
