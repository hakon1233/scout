import { expect, test } from "@playwright/test";
import { PORT } from "./port";

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

// The open filter menu stays inside the viewport at common mobile widths.
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
