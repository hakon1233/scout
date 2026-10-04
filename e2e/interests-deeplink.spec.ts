import { expect, test, type Page } from "@playwright/test";
import { PORT } from "./port";

const ORIGIN = `http://127.0.0.1:${PORT}`;

// The interest workbench syncs the open doc to `?id=`: a deep link opens it on
// first load, and browser Back or the on-screen Close returns to the card list.

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost")
    ) {
      return route.continue();
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return route.continue(); // data:, blob:, about: — harmless
    }
    return route.abort();
  });
}

test.describe("interest doc deep-link, Back and Close", () => {
  test("deep-linking ?id= renders the scope view on first load, chat intact", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Land directly on the drilled-in URL — the mount-time readId() path, never
    // hit by the click flow. A bookmark/refresh of a shared interest link.
    await page.goto(`${ORIGIN}/app/interests/?mock=1&id=ai-policy`);

    // The scope view — not the card list — is what hydrates.
    await expect(
      page.locator("header").getByText("Assignment", { exact: true }),
    ).toBeVisible();
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
    await expect(
      page.locator("header").getByText("Assignment", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/app\/interests\/\?.*id=ai-policy/);

    // THE assertion: the real browser Back button (popstate) — not the
    // on-screen "← Interests" control — pops the pushed entry and clears the
    // selection, landing back on the card list with the id stripped.
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await expect(
      page.locator("header").getByText("Assignment", { exact: true }),
    ).toBeHidden();
    await expect(page).not.toHaveURL(/id=ai-policy/);

    // Chat stays mounted across the back navigation.
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();
  });

  test("deep-link into a doc, then click on-screen Close (not browser Back)", async ({
    page,
  }) => {
    await blockNonLoopback(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${ORIGIN}/app/interests/?mock=1&id=ai-policy`);
    await expect(
      page.getByRole("heading", { name: "AI policy & regulation" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/id=ai-policy/);

    await page.getByRole("button", { name: "← Interests" }).click();

    // The replaceState branch cleared the id and restored the card list —
    // the OTHER query params (here `mock=1`) survive since it edits the URL
    // object rather than replacing the whole query string.
    await expect(
      page.getByRole("heading", { name: "Skills setup" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/mock=1/);
    await expect(page).not.toHaveURL(/id=ai-policy/);

    // Because Close used replaceState (not pushState), there is no extra
    // history entry for this page to consume — a real browser Back from here
    // leaves the app entirely rather than "un-closing" the doc.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/app\/interests\//);
  });
});
