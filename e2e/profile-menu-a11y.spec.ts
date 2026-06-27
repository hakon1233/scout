import { expect, test } from "@playwright/test";

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

// CAR-245: the profile/settings popover is a disclosure, not an ARIA
// application menu. It is navigated with Tab (no roving tabindex, no
// arrow-key item navigation, no focus trap), so it must NOT expose
// role="menu"/role="menuitem" — exposing them would promise keyboard
// behaviour the component does not implement. This test pins the
// keyboard contract that DOES hold: open from the keyboard, Tab into the
// panel, and Escape to close while returning focus to the trigger.
test("profile menu is a keyboard-operable disclosure, not an ARIA menu", async ({
  page,
}) => {
  await blockNonLoopback(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("scout.theme", "light");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "A11y Tester",
        interests: [{ id: "int_ai_safety", topic: "AI safety" }],
      }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);

  const trigger = page.getByRole("button", { name: "Open settings" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // Open with the keyboard (Enter on the focused trigger).
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");

  const panel = page.getByRole("group", { name: "Settings" });
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // The popover must not advertise application-menu semantics it doesn't back.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(0);

  // The settings navigation links live inside the panel and are reachable.
  await expect(panel.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

  // Tab from the trigger moves focus into the panel content (plain Tab order).
  await page.keyboard.press("Tab");
  const focusLandedInPanel = await page.evaluate(() => {
    const panelEl = document.querySelector(
      '[role="group"][aria-label="Settings"]',
    );
    return Boolean(
      panelEl &&
        document.activeElement &&
        panelEl.contains(document.activeElement),
    );
  });
  expect(focusLandedInPanel).toBe(true);

  // Escape closes the popover and returns focus to the trigger so keyboard
  // users are never dropped onto <body>.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
