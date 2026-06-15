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

test("feed filter uses dark theme tokens for its button and menu", async ({
  page,
}) => {
  await blockNonLoopback(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("scout.theme", "dark");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "Theme Tester",
        interests: [
          { id: "int_ai_safety", topic: "AI safety" },
          { id: "int_energy", topic: "Energy" },
        ],
      }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);
  await expect(page.locator("html")).toHaveClass(/dark/);

  const filter = page.getByRole("button", { name: "Filter feed" });
  await expect(filter).toBeVisible();
  await filter.click();

  const menu = page.getByRole("menu", { name: "Filter feed by topic" });
  await expect(menu).toBeVisible();

  await expect(menu).toHaveCSS("background-color", "rgb(22, 20, 15)");
  await expect(menu).toHaveCSS("border-color", "rgb(55, 50, 42)");
  await expect(menu.getByText("Filter by topic")).toHaveCSS(
    "color",
    "rgb(154, 145, 127)",
  );

  await menu.getByRole("menuitem", { name: "AI safety" }).click();

  const activeFilter = page.getByRole("button", {
    name: "Filtering by AI safety",
  });
  await expect(activeFilter).toHaveCSS(
    "background-color",
    "rgb(36, 32, 26)",
  );
  await expect(activeFilter).toHaveCSS("border-color", "rgb(196, 85, 63)");
  await expect(activeFilter).toHaveCSS("color", "rgb(196, 85, 63)");
});

test("feed filter keeps the established light theme colors", async ({
  page,
}) => {
  await blockNonLoopback(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("scout.theme", "light");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "Theme Tester",
        interests: [{ id: "int_ai_safety", topic: "AI safety" }],
      }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "Filter feed" }).click();

  const menu = page.getByRole("menu", { name: "Filter feed by topic" });
  await expect(menu).toHaveCSS("background-color", "rgb(246, 242, 234)");
  await expect(menu).toHaveCSS("border-color", "rgb(216, 208, 193)");

  const selectedAll = menu.getByRole("menuitem", { name: "All topics" });
  await expect(selectedAll).toHaveCSS("background-color", "rgb(154, 59, 46)");
  await expect(selectedAll).toHaveCSS("color", "rgb(246, 242, 234)");

  await menu.getByRole("menuitem", { name: "AI safety" }).click();

  const activeFilter = page.getByRole("button", {
    name: "Filtering by AI safety",
  });
  await expect(activeFilter).toHaveCSS(
    "background-color",
    "rgb(239, 233, 221)",
  );
  await expect(activeFilter).toHaveCSS("border-color", "rgb(154, 59, 46)");
  await expect(activeFilter).toHaveCSS("color", "rgb(154, 59, 46)");
});
