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

  const menu = page.getByRole("group", { name: "Filter by topic" });
  await expect(menu).toBeVisible();

  await expect(menu).toHaveCSS("background-color", "rgb(22, 20, 15)");
  await expect(menu).toHaveCSS("border-color", "rgb(55, 50, 42)");
  await expect(menu.getByText("Filter by topic")).toHaveCSS(
    "color",
    "rgb(154, 145, 127)",
  );

  await menu.getByRole("button", { name: "AI safety" }).click();

  const activeFilter = page.getByRole("button", {
    name: "Filtering by AI safety",
  });
  await expect(activeFilter).toHaveCSS(
    "background-color",
    "rgb(36, 32, 26)",
  );
  // Dark-mode --accent-signal is #d2694c (rgb(210,105,76)); PER-264 lightened
  // it from #c4553f to reach WCAG AA contrast (see src/app/globals.css).
  await expect(activeFilter).toHaveCSS("border-color", "rgb(210, 105, 76)");
  await expect(activeFilter).toHaveCSS("color", "rgb(210, 105, 76)");
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

  const menu = page.getByRole("group", { name: "Filter by topic" });
  await expect(menu).toHaveCSS("background-color", "rgb(246, 242, 234)");
  await expect(menu).toHaveCSS("border-color", "rgb(216, 208, 193)");

  const selectedAll = menu.getByRole("button", { name: "All topics" });
  await expect(selectedAll).toHaveCSS("background-color", "rgb(154, 59, 46)");
  await expect(selectedAll).toHaveCSS("color", "rgb(246, 242, 234)");

  await menu.getByRole("button", { name: "AI safety" }).click();

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

test("feed filter topic labels use available dropdown space before ellipsis", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  const topic = "International energy storage policy";

  await page.addInitScript((seedTopic) => {
    window.localStorage.setItem("scout.theme", "light");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "Layout Tester",
        interests: [{ id: "int_energy_storage", topic: seedTopic }],
      }),
    );
  }, topic);

  await page.goto(`${ORIGIN}/app/`);
  await page.getByRole("button", { name: "Filter feed" }).click();

  const menu = page.getByRole("group", { name: "Filter by topic" });
  const label = menu.getByRole("button", { name: topic }).locator("span");

  await expect(label).toBeVisible();

  const metrics = await label.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(metrics.clientWidth).toBeGreaterThanOrEqual(metrics.scrollWidth);
});

// PER-262 regression: PER-249 inserted the Liked icon between the filter
// trigger and the profile menu, which pushed the trigger left of where the
// old `absolute right-0` + viewport-width menu assumed it sat — the menu
// then spilled off the left edge on mobile widths. Assert full containment
// at a spread of common mobile widths so a future header change can't quietly
// break this positioning math again.
for (const width of [360, 390, 430]) {
  test(`feed filter menu stays fully within the ${width}px viewport`, async ({
    page,
  }) => {
    await blockNonLoopback(page);
    await page.setViewportSize({ width, height: 800 });

    await page.addInitScript(() => {
      window.localStorage.setItem("scout.theme", "light");
      window.localStorage.setItem(
        "scout.settings.v1",
        JSON.stringify({
          name: "Viewport Tester",
          interests: [
            { id: "int_ai_safety", topic: "AI safety" },
            { id: "int_energy", topic: "Energy" },
          ],
        }),
      );
    });

    await page.goto(`${ORIGIN}/app/`);
    await page.getByRole("button", { name: "Filter feed" }).click();

    const menu = page.getByRole("group", { name: "Filter by topic" });
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
}

test("feed filter matches model topic headings case-insensitively", async ({
  page,
}) => {
  await blockNonLoopback(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("scout.theme", "light");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "Filter Tester",
        interests: [
          { id: "int_openai", topic: "openai" },
          { id: "int_energy", topic: "Energy" },
        ],
      }),
    );
    window.localStorage.setItem(
      "scout.lastBrief.v1",
      JSON.stringify({
        id: "case-brief",
        generatedAt: "2026-06-20T08:00:00.000Z",
        interests: ["openai", "Energy"],
        markdown: "",
        articles: [
          {
            id: "case-brief-0",
            title: "example.com — OpenAI launches a research preview",
            url: "https://example.com/openai-preview",
            source: "example.com",
            publishedAt: "2026-06-20",
            interest: "OpenAI",
            text: "The model heading used title case.",
          },
          {
            id: "case-brief-1",
            title: "example.com — Grid batteries scale up",
            url: "https://example.com/grid-batteries",
            source: "example.com",
            publishedAt: "2026-06-19",
            interest: "Energy",
            text: "A separate topic should be hidden by the filter.",
          },
        ],
      }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);
  await page.getByRole("button", { name: "Filter feed" }).click();
  await page
    .getByRole("group", { name: "Filter by topic" })
    .getByRole("button", { name: "openai" })
    .click();

  await expect(
    page.getByRole("heading", { name: "OpenAI launches a research preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Grid batteries scale up" }),
  ).toHaveCount(0);
});
