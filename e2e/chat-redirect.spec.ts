import { expect, test } from "@playwright/test";
import { PORT } from "./port";

const ORIGIN = `http://127.0.0.1:${PORT}`;

// The legacy `/app/chat` route forwards to `/app/interests`, carrying its query
// string so an old `?focus=` deep link still focuses the matching card.
test.describe("legacy /app/chat redirect", () => {
  test("forwards to /app/interests and the Interests page renders", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/chat/`);

    await expect(page).toHaveURL(`${ORIGIN}/app/interests/`, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", { name: "Interests", level: 2 }),
    ).toBeVisible();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();

    // The "Chat moved" stub itself must not linger behind the redirect.
    await expect(page.getByText("Chat moved")).toBeHidden();
  });

  test("?focus= survives the redirect and actually focuses the matching card", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/chat/?mock=1&focus=ai-policy`);

    // The replace lands on Interests, query intact.
    await expect(page).toHaveURL(
      `${ORIGIN}/app/interests/?mock=1&focus=ai-policy`,
      { timeout: 15_000 },
    );

    // THE assertion: this is not just a URL match — useProfileWorkbench's
    // mount effect actually read `focus` off the forwarded query and set
    // focusKey, so the AI policy card renders already toggled into its
    // "Editing" (focused) state, exactly as InterestDocCard.tsx renders a
    // focused card (aria-pressed + "Editing" label on the toggle button).
    const card = page.getByLabel("Interest: AI policy & regulation");
    await expect(card).toBeVisible();
    const toggle = card.getByRole("button", { name: "Editing" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});
