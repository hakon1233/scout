import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

test.describe("responsive interest workbench", () => {
  test("desktop: big interests+skills pane LEFT, narrow chat RIGHT", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    await expect(
      page.getByRole("heading", { name: "Interests" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
    await expect(page.getByLabel("Message Scout")).toBeVisible();

    // The flip (PER-233): chat is the narrow clamped column on the RIGHT;
    // the interests+skills pane owns the majority of the width on the left.
    const chatBox = await page.getByLabel("Chat with Scout").boundingBox();
    expect(chatBox).not.toBeNull();
    expect(chatBox!.width).toBeLessThanOrEqual(420);
    expect(chatBox!.x).toBeGreaterThan(1440 / 2);

    await page.getByRole("button", { name: "Refine" }).first().click();
    await expect(page).toHaveURL(/\/app\/interests/);
    await expect(page.getByLabel("Message Scout")).toHaveAttribute(
      "placeholder",
      /AI policy & regulation/,
    );
  });

  test("mobile: segmented toggle reaches both chat and interests+skills", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    // Chat is the default view; the big pane is one tap away.
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();

    await page.getByRole("button", { name: /Interests & skills/ }).click();
    await expect(
      page.getByRole("heading", { name: "Interests" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await expect(page.getByLabel("Chat with Scout")).toBeHidden();

    // No horizontal overflow at 390.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
  });
});
