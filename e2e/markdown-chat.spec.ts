import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

test("chat renders user and assistant markdown safely", async ({ page }) => {
  await page.goto(`${ORIGIN}/app/chat?mock=markdown`);

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
