import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: [number, number, number]) {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function rgb(styleValue: string): [number, number, number] {
  const match = styleValue.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`Expected rgb color, received ${styleValue}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

test("chat renders user and assistant markdown safely", async ({ page }) => {
  await page.goto(`${ORIGIN}/app/interests?mock=markdown`);

  await expect(
    page.getByRole("heading", { name: "Scout markdown reply" }),
  ).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "assistant emphasis" }),
  ).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "user emphasis" }),
  ).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("quoted context");
  await expect(page.locator("pre code")).toContainText("const topic");

  const link = page.getByRole("link", { name: "source link" });
  await expect(link).toHaveAttribute("href", "https://example.com/brief");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  await expect(page.getByText("xss()")).toBeVisible();
  await expect(page.locator("script", { hasText: "xss()" })).toHaveCount(0);
});

test("user bubble strong markdown remains legible on the dark surface", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/interests?mock=markdown`);

  const styles = await page
    .locator("strong", { hasText: "user emphasis" })
    .evaluate((strong) => {
      const bubble = strong.closest(".bg-accent");
      if (!bubble) throw new Error("Missing user message bubble");
      return {
        color: getComputedStyle(strong).color,
        backgroundColor: getComputedStyle(bubble).backgroundColor,
      };
    });

  expect(styles.color).not.toBe(styles.backgroundColor);
  expect(
    contrastRatio(rgb(styles.color), rgb(styles.backgroundColor)),
  ).toBeGreaterThanOrEqual(4.5);
});
