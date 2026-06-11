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

  // PER-236 fix 2: drilling into a single interest doc must NOT lose the chat.
  // The scope view replaces only the left pane; the chat column stays mounted.
  test("desktop: opening an interest doc keeps the chat visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    // Open the first interest card by its title link.
    await page
      .getByRole("link", { name: "AI policy & regulation" })
      .first()
      .click();

    // In-page drill-in: scope view in the left pane, ?id= in the URL, no
    // navigation to the chat-less standalone page.
    await expect(page.getByText("Research scope")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI policy & regulation" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/app\/interests\/\?.*id=/);

    // THE assertion: chat is still there, same narrow right column.
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
    await expect(page.getByLabel("Message Scout")).toBeVisible();
    const chatBox = await page.getByLabel("Chat with Scout").boundingBox();
    expect(chatBox).not.toBeNull();
    expect(chatBox!.width).toBeLessThanOrEqual(420);
    expect(chatBox!.x).toBeGreaterThan(1440 / 2);

    // "Refine in chat" focuses this interest in the adjacent chat.
    await page.getByRole("button", { name: "Refine in chat" }).click();
    await expect(page.getByLabel("Message Scout")).toHaveAttribute(
      "placeholder",
      /AI policy & regulation/,
    );

    // Back returns to the card list without losing the chat.
    await page.getByRole("button", { name: "← Interests" }).click();
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
  });

  test("mobile: interest doc detail opens in the docs tab; chat one toggle away", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    await page.getByRole("button", { name: /Interests & skills/ }).click();
    await page
      .getByRole("link", { name: "AI policy & regulation" })
      .first()
      .click();

    await expect(page.getByText("Research scope")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI policy & regulation" }),
    ).toBeVisible();

    // Chat stays one toggle away (collapsed, reachable — the mobile contract).
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();

    // …and toggling back returns to the doc detail, not the card list.
    await page.getByRole("button", { name: /Interests & skills/ }).click();
    await expect(page.getByText("Research scope")).toBeVisible();
  });
});
