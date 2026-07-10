import { expect, test } from "@playwright/test";

// QA-live (AIR-160): browser coverage for the Settings → "Scheduled briefs"
// flow (PER-152). This was the last key user flow with a real backend write
// (PUT /v0/schedule) and no headless test. It drives the live companion
// endpoint through the actual UI controls — the enable switch and the
// time-of-day picker — and proves the writes persist across a reload, then
// asserts the server-side contract (auth + validation + same-origin guard)
// directly against /v0/schedule.
//
// Offline/deterministic like the rest of the suite: same-origin token
// auto-adoption (no paste), the claude shell-out stubbed, every non-loopback
// request blocked. The scheduler's default is { enabled: true,
// time_of_day: "07:00" } (state.ts defaultSchedule), materialized on first read.
//
// State hygiene: tests share one companion process (workers:1), so the UI test
// restores the default (on / 07:00) before it ends, and the contract test only
// sends INVALID writes (rejected before any mutation) so neither test leaks
// schedule state into the other regardless of order.

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

test("Settings schedule: toggle + time-of-day write through the live companion and persist", async ({
  page,
}, testInfo) => {
  await blockNonLoopback(page);
  await page.addInitScript(() => window.localStorage.setItem("scout.theme", "light"));

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

test("/v0/schedule contract: auth required, input validated, cross-origin denied", async ({
  request,
}) => {
  // Same-origin GET /v0/config hands back the loopback pairing token (the same
  // bootstrap the browser does), which authorizes the schedule endpoint.
  const cfg = await request.get(`${ORIGIN}/v0/config`, {
    headers: { origin: ORIGIN },
  });
  expect(cfg.status()).toBe(200);
  const token = ((await cfg.json()) as { token?: string }).token ?? "";
  expect(token.length).toBeGreaterThan(0);

  // No bearer → 401 (the endpoint is not readable without the pairing token).
  const noAuth = await request.get(`${ORIGIN}/v0/schedule`, {
    headers: { origin: ORIGIN },
  });
  expect(noAuth.status()).toBe(401);

  // Authed GET → 200 with the documented ScheduleView shape.
  const ok = await request.get(`${ORIGIN}/v0/schedule`, {
    headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
  });
  expect(ok.status()).toBe(200);
  const view = (await ok.json()) as Record<string, unknown>;
  expect(typeof view.enabled).toBe("boolean");
  expect(typeof view.time_of_day).toBe("string");
  expect("next_run_at" in view).toBe(true);
  expect("reboot_durable" in view).toBe(true);

  // Malformed writes are rejected (400) before any mutation — these guard the
  // documented PUT validation and keep this test non-mutating.
  const badTime = await request.put(`${ORIGIN}/v0/schedule`, {
    headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
    data: { time_of_day: "9am" },
  });
  expect(badTime.status()).toBe(400);

  const badEnabled = await request.put(`${ORIGIN}/v0/schedule`, {
    headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
    data: { enabled: "yes" },
  });
  expect(badEnabled.status()).toBe(400);

  // Cross-origin PUT is denied by the same-origin guard (403) — a hostile web
  // page must not be able to reprogram the local companion's schedule. The
  // guard runs ahead of auth, so even a valid token over a foreign Origin is
  // rejected.
  const crossOrigin = await request.put(`${ORIGIN}/v0/schedule`, {
    headers: {
      origin: "http://evil.example.com",
      authorization: `Bearer ${token}`,
    },
    data: { enabled: false },
  });
  expect(crossOrigin.status()).toBe(403);
});
