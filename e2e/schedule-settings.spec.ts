import { expect, test } from "@playwright/test";
import { PORT } from "./port";

// Settings → "Scheduled briefs": the enable switch and time picker write
// through PUT /v0/schedule and persist across a reload.

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

test("Settings schedule: toggle + time-of-day write through the live companion and persist", async ({
  page,
}, testInfo) => {
  await blockNonLoopback(page);
  await page.addInitScript(() =>
    window.localStorage.setItem("scout.theme", "light"),
  );

  await page.goto(`${ORIGIN}/app/settings/`);

  // The schedule section loads from GET /v0/schedule (not the "unreachable"
  // banner — the companion is paired same-origin). Default is enabled.
  await expect(
    page.getByRole("heading", { name: "Scheduled briefs" }),
  ).toBeVisible();

  const toggle = page.getByRole("switch", {
    name: "Enable the daily scheduled brief",
  });
  const time = page.locator("#schedule-time");

  // Default materialized state: on, 07:00, picker enabled.
  await expect(toggle).toHaveAttribute("aria-checked", "true", {
    timeout: 15_000,
  });
  await expect(time).toHaveValue("07:00");
  await expect(time).toBeEnabled();
  await expect(page.getByText(/On\b.*runs at/)).toBeVisible();

  // Disable: PUT { enabled:false } → the picker disables and the next-run line
  // collapses to "—" (NextRunRow only shows a timestamp while enabled).
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(time).toBeDisabled();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Next run").locator("xpath=following-sibling::*[1]"),
  ).toHaveText("—");

  // Persistence, not just session state: a full reload re-reads /v0/schedule and
  // the disabled state survives.
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false", {
    timeout: 15_000,
  });
  await expect(time).toBeDisabled();

  // Re-enable and change the time-of-day. The native picker's change drives
  // commit({ time_of_day }) → PUT → the companion echoes the normalized value
  // back, which the input re-renders from.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(time).toBeEnabled();

  await time.fill("09:30");
  await expect(time).toHaveValue("09:30");
  await expect(time).toBeEnabled(); // saving settled (re-enabled after PUT)

  // The new time survives a reload — proof the write reached state.json, not
  // just the controlled input.
  await page.reload();
  await expect(time).toHaveValue("09:30", { timeout: 15_000 });

  await testInfo.attach("settings-schedule", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  // Restore the default so this test leaves no schedule drift for siblings.
  await time.fill("07:00");
  await expect(time).toHaveValue("07:00");
});
