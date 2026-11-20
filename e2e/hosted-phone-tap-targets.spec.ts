import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// Tap targets on the hosted app (fake backend, src/lib/hosted-fake.ts): at
// phone width every control's hit area is at least 44 px tall and nothing
// scrolls sideways; at desktop width the shared sizes stay as they were
// (sm button 36, segment 32, switch 24). The sizes live in globals.css (the
// `phone` variant and `tap-target`) and src/components/ui.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const PAGES = [
  "/app/",
  "/app/topics/?id=power",
  "/app/settings/",
  "/app/upgrade/",
];

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1") || !/^https?:\/\//.test(url)
      ? route.continue()
      : route.abort();
  });
}

/** Controls whose hit area (box, or a positioned ::after) is under 44 px. */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
    const out: string[] = [];
    const sel =
      "a[href], button, [role=switch], [role=radio], input:not([type=hidden]), select, textarea, summary";
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let h = r.height;
      const a = getComputedStyle(el, "::after");
      if (a.content !== "none" && a.position === "absolute")
        h = Math.max(h, h - px(a.top) - px(a.bottom));
      if (h < 43.99)
        out.push(`${(el.textContent ?? "").trim().slice(0, 30)} ${h}`);
    }
    return {
      small: out,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

test("at 390 px every control is at least 44 px tall", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of PAGES) {
    await page.goto(`${ORIGIN}${path}`);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    expect(await smallTargets(page), path).toEqual({
      small: [],
      sideways: false,
    });
  }
});

test("at 1280 px the shared sizes are unchanged", async ({ page }) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ORIGIN}/app/settings/`);
  await expect(page.getByRole("radio", { name: "Light" })).toBeVisible({
    timeout: 60_000,
  });
  const height = async (name: string, role: "radio" | "button" | "switch") =>
    (await page.getByRole(role, { name }).boundingBox())?.height;
  expect(await height("Light", "radio")).toBe(32);
  expect(await height("Sign out", "button")).toBe(36);
  expect(await height("Notify me when a brief is ready", "switch")).toBe(24);
});
