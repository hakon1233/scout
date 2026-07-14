import { expect, test, type Page } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// AIR-512: the "Scroll to latest" pill scrolls the transcript from JavaScript
// (`scrollTo({ behavior })`). The global reduced-motion CSS clamps CSS
// transitions but cannot reach JS-driven scrolling, so ChatDock must pick the
// behavior from `prefers-reduced-motion` itself: "auto" for reduced-motion
// users, "smooth" for everyone else.

// Surface the pill (needs an overflowing transcript held away from the bottom),
// then return the `behavior` the transcript's scrollTo receives when it is
// clicked.
async function pillScrollBehavior(
  page: Page,
  reducedMotion: "reduce" | "no-preference",
): Promise<string | undefined> {
  await page.emulateMedia({ reducedMotion });

  // A short viewport guarantees the seeded markdown transcript overflows.
  await page.setViewportSize({ width: 1280, height: 380 });
  await page.goto(`${ORIGIN}/app/interests?mock=markdown`);

  const log = page.getByRole("log", { name: "Conversation with Scout" });
  await expect(log).toBeVisible();

  // Record the `behavior` of every scrollTo the transcript receives.
  await log.evaluate((el) => {
    const w = window as unknown as { __behaviors: string[] };
    w.__behaviors = [];
    const orig = el.scrollTo.bind(el) as typeof el.scrollTo;
    el.scrollTo = ((arg?: ScrollToOptions | number, y?: number) => {
      if (arg && typeof arg === "object")
        w.__behaviors.push(arg.behavior ?? "auto");
      return (orig as (a?: ScrollToOptions | number, b?: number) => void)(
        arg,
        y,
      );
    }) as typeof el.scrollTo;
  });

  // Scroll up so the app holds position and surfaces the pill.
  await log.evaluate((el) => el.scrollTo({ top: 0 }));
  const pill = page.getByRole("button", { name: /Scroll to latest/ });
  await expect(pill).toBeVisible();

  // Drop the setup scroll, then click - the first recorded behavior is the
  // pill's choice (a follow-up autoscroll effect may append another).
  await page.evaluate(() => {
    (window as unknown as { __behaviors: string[] }).__behaviors = [];
  });
  await pill.click();

  return page.evaluate(
    () => (window as unknown as { __behaviors: string[] }).__behaviors[0],
  );
}

test.describe("reduced-motion chat scroll-to-latest", () => {
  test("reduced-motion users get an instant (auto) jump", async ({ page }) => {
    expect(await pillScrollBehavior(page, "reduce")).toBe("auto");
  });

  test("no-preference users keep smooth scrolling", async ({ page }) => {
    expect(await pillScrollBehavior(page, "no-preference")).toBe("smooth");
  });
});
