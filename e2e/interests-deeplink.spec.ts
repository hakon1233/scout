import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The interest workbench drill-in (PER-236 fix 2) syncs the open doc to the URL
// as `?id=` and restores it from the URL on mount. responsive-chat.spec.ts
// already covers the *click* drill-in and the on-screen "← Interests" button.
// This spec covers the two adjacent paths it does not exercise:
//   1. arriving directly at `?id=` (URL → state hydration on first load — the
//      shareable/refresh case), and
//   2. the *browser* Back button (real popstate), not the on-screen control.
// Both run fully offline against the mock seed (id=ai-policy → "AI policy &
// regulation"); no companion data, no paid scrape.
test.describe("interest doc deep-link + browser back", () => {
  test("deep-linking ?id= renders the scope view on first load, chat intact", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Land directly on the drilled-in URL — the mount-time readId() path, never
    // hit by the click flow. A bookmark/refresh of a shared interest link.
    await page.goto(`${ORIGIN}/app/interests/?mock=1&id=ai-policy`);

    // The scope view — not the card list — is what hydrates.
    await expect(page.getByText("Research scope")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI policy & regulation" }),
    ).toBeVisible();
    // The card-list-only "Skills setup" section must NOT be on screen.
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeHidden();

    // The narrow chat column survives the deep-link, same as the click path.
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
    const chatBox = await page.getByLabel("Chat with Scout").boundingBox();
    expect(chatBox).not.toBeNull();
    expect(chatBox!.width).toBeLessThanOrEqual(420);
    expect(chatBox!.x).toBeGreaterThan(1440 / 2);
  });

  test("browser Back from a drilled-in doc returns to the card list", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ORIGIN}/app/interests/?mock=1`);

    // Start on the card list, then drill in by clicking — this pushes a history
    // entry carrying ?id=.
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "AI policy & regulation" })
      .first()
      .click();
    await expect(page.getByText("Research scope")).toBeVisible();
    await expect(page).toHaveURL(/\/app\/interests\/\?.*id=ai-policy/);

    // THE assertion: the real browser Back button (popstate) — not the
    // on-screen "← Interests" control — pops the pushed entry and clears the
    // selection, landing back on the card list with the id stripped.
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await expect(page.getByText("Research scope")).toBeHidden();
    await expect(page).not.toHaveURL(/id=ai-policy/);

    // Chat stays mounted across the back navigation.
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
  });
});
