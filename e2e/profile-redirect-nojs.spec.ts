import { expect, test } from "@playwright/test";

// AIR-254 (Browser QA pass) — the no-JS half of `/app/profile/`'s
// progressive-enhancement redirect. profile-redirect.spec.ts already covers
// the with-JS `router.replace` path (and the Back-button non-trap); this
// spec is the other half: the statically-exported HTML still renders a
// "Choose a profile page" disambiguation card linking to Settings / Interests
// / Skills, so a visitor whose JS failed (or hasn't hydrated yet) still has a
// way forward instead of dead-ending on a blank redirect stub.
//
// Split into its own file (rather than folded into profile-redirect.spec.ts)
// so `test.use({ javaScriptEnabled: false })` only disables JS for this one
// file's project run, not its sibling's.
//
// Fully offline against the served static export; no companion data, no scrape.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function blockNonLoopback(page: import("@playwright/test").Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost")
    ) {
      return route.continue();
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return route.continue();
    }
    return route.abort();
  });
}

test.describe("no-JS fallback", () => {
  test.use({ javaScriptEnabled: false });

  test("/app/profile renders working disambiguation links without JS", async ({
    page,
  }) => {
    await blockNonLoopback(page);

    await page.goto(`${ORIGIN}/app/profile/`);

    // No JS => the useEffect redirect never fires; the visitor stays on the
    // page and must be able to navigate onward via the rendered links.
    await expect(page).toHaveURL(`${ORIGIN}/app/profile/`);

    const card = page.locator("section", {
      hasText: "Choose a profile page",
    });
    await expect(
      card.getByRole("heading", { name: "Choose a profile page" }),
    ).toBeVisible();

    await expect(card.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      /\/app\/settings\/?$/,
    );
    await expect(
      card.getByRole("link", { name: "Interests & chat" }),
    ).toHaveAttribute("href", /\/app\/interests\/?$/);
    await expect(card.getByRole("link", { name: "Skills" })).toHaveAttribute(
      "href",
      /\/app\/skills\/?$/,
    );
  });
});
