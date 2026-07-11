import { expect, test, type Page } from "@playwright/test";

// AIR-283 — Settings → Theme toggle (Light / Dark / System), driven headless.
//
// Why this matters: the theme control is the one Settings surface a user touches
// every visit, and its contract is split across TWO code paths that must agree:
//   1. ThemeBootstrap — a blocking <head> script that paints the stored theme at
//      first byte (no FOUC, PER-131) AND sets <html>.style.colorScheme so UA
//      surfaces (scrollbars, the native time <input> on Settings) match.
//   2. applyTheme (ThemeToggle.tsx) — the runtime click handler.
// Nothing proved (a) a Dark pick survives a reload with `.dark` already on
// <html> before React mounts, or (b) that "System" actually tracks the OS
// preference live. Fully offline: no companion calls, no network, no keys.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

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

function themeGroup(page: Page) {
  return page.getByRole("radiogroup", { name: "Theme" });
}

test.describe("settings · theme toggle", () => {
  test.beforeEach(async ({ page }) => {
    await blockNonLoopback(page);
    // Deterministic OS baseline so "System" has a known meaning per test.
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("picking Dark sticks across reload and paints before React mounts (no FOUC)", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/settings/`);
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/); // System → light baseline

    await themeGroup(page).getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);
    await expect(
      themeGroup(page).getByRole("radio", { name: "Dark" }),
    ).toHaveAttribute("aria-checked", "true");

    // Reload with waitUntil:commit so we observe the document as soon as the
    // blocking <head> bootstrap has run — BEFORE the React bundle hydrates.
    // The class must already be there: proof of the no-flash contract.
    await page.goto(`${ORIGIN}/app/settings/`, { waitUntil: "commit" });
    await expect(html).toHaveClass(/dark/);
    // Bootstrap also keeps color-scheme honest for UA surfaces.
    await expect(html).toHaveJSProperty("style.colorScheme", "dark");
  });

  test("picking Light sticks across reload (overrides a dark OS preference)", async ({
    page,
  }) => {
    // OS prefers dark; an explicit Light pick must win and persist.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${ORIGIN}/app/settings/`);
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/); // System → dark baseline

    await themeGroup(page).getByRole("radio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/dark/);

    await page.goto(`${ORIGIN}/app/settings/`, { waitUntil: "commit" });
    await expect(html).not.toHaveClass(/dark/);
  });

  test("System tracks the OS preference live (matchMedia change re-applies)", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/settings/`);
    const html = page.locator("html");
    await themeGroup(page).getByRole("radio", { name: "System" }).click();

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveClass(/dark/);

    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).not.toHaveClass(/dark/);
  });

  // KNOWN BUG (AIR-283 QA finding) — runtime theme switches update the `.dark`
  // class but NOT <html>.style.colorScheme, so native UA surfaces (scrollbars,
  // the Settings/Schedule time <input>) keep painting in the OLD mode until a
  // reload runs ThemeBootstrap. The bootstrap sets both; applyTheme() sets only
  // the class. Flip this to a normal test once the fix lands. Tracked by the
  // child fix-issue filed from this pass.
  test.fixme("runtime Light→Dark switch keeps color-scheme in sync for UA surfaces", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/settings/`);
    const html = page.locator("html");
    await themeGroup(page).getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);
    // BUG: stays "light" until reload.
    await expect(html).toHaveJSProperty("style.colorScheme", "dark");
  });
});
