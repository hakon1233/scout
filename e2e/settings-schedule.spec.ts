import { expect, test } from "@playwright/test";

// Settings → "Scheduled briefs" (PER-152) end-to-end against the REAL packed
// companion. The committed suite already proves same-origin auto-adopt for the
// brief loop (zero-prompt.spec) and the theme control on Settings
// (feed-filter-theme covers tokens, not Settings), but the schedule controls —
// the only Settings surface that drives real backend writes (GET|PUT
// /v0/schedule) — were untested. This locks in the PER-139 contract: "no
// setting that saves nothing." Every assertion that the DOM reflects a changed
// value is, by construction, a wait for a successful companion round-trip,
// because both controls are CONTROLLED by the schedule the server echoes back
// (ScheduleSettings.commit awaits updateSchedule before setState) — a typed
// value or a toggle click only "sticks" in the DOM once the PUT resolves. A
// reload then re-fetches from the companion, so persistence across reload
// proves the write hit state.json, not just React state.
//
// Offline/deterministic: served same-origin from the loopback companion the
// webServer boots; no Anthropic/Exa key, no network, no Apify.
//
// AIR-744: this file absorbed schedule-settings.spec.ts, a near-duplicate
// covering the identical PER-152 flow — two separate QA-live passes picked
// the same untested gap independently and each wrote a full spec for it. Kept
// this file's two more narrowly-scoped UI tests and folded in the other
// file's one genuinely non-overlapping test (the direct /v0/schedule
// auth/validation/cross-origin contract, below) rather than running both.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Same belt-and-suspenders offline guard the rest of the suite uses: abort any
// non-loopback request so a stray remote dependency fails loudly.
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

// Land on Settings and wait for the schedule to resolve from "loading" into the
// "ready" state — i.e. the companion was reached same-origin and the controls
// rendered. Returns the two live controls.
async function openScheduleSettings(page: import("@playwright/test").Page) {
  await page.goto(`${ORIGIN}/app/settings/`);
  await expect(
    page.getByRole("heading", { name: "Scheduled briefs" }),
  ).toBeVisible({ timeout: 15_000 });
  const toggle = page.getByRole("switch", {
    name: "Enable the daily scheduled brief",
  });
  const timeInput = page.locator("#schedule-time");
  // "ready" state has both controls; the unreachable state has neither (it
  // shows a "Start scout-agent run" banner instead). Reaching here proves
  // same-origin auto-adopt works for Settings too.
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  return { toggle, timeInput };
}

test("scheduled-brief time-of-day persists across reload (real companion write)", async ({
  page,
}) => {
  await blockNonLoopback(page);
  const { toggle, timeInput } = await openScheduleSettings(page);

  // Precondition: the time picker is only editable while the daily brief is
  // enabled. Establish the enabled state regardless of where the run started.
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });
  }

  // Change the run time. The input is controlled by the server-echoed schedule,
  // so it only reads back "06:15" once PUT /v0/schedule has persisted it.
  await timeInput.fill("06:15");
  await expect(timeInput).toHaveValue("06:15", { timeout: 10_000 });

  // Reload wipes React state; the value must come back from the companion.
  await page.reload();
  const { timeInput: afterReload } = await openScheduleSettings(page);
  await expect(afterReload).toHaveValue("06:15");

  // Restore the default so this test leaves no schedule drift for siblings
  // (workers:1 shares one companion process across the whole suite).
  await afterReload.fill("07:00");
  await expect(afterReload).toHaveValue("07:00");
});

test("disabling the daily brief persists and clears the next-run time", async ({
  page,
}) => {
  await blockNonLoopback(page);
  const { toggle } = await openScheduleSettings(page);

  // Ensure it starts enabled so the toggle-off transition is the thing under
  // test (and is observable), independent of prior tests' leftover state.
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });
  }

  // Disable. aria-checked is controlled by the server-echoed schedule, so it
  // flips to "false" only after the PUT persists.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false", {
    timeout: 10_000,
  });

  // With scheduling off, the legibility row reports no upcoming run.
  await expect(
    page.getByText("Next run").locator("xpath=following-sibling::*[1]"),
  ).toHaveText("—");

  // Persisted: a reload re-fetches "disabled" from the companion.
  await page.reload();
  const { toggle: afterReload } = await openScheduleSettings(page);
  await expect(afterReload).toHaveAttribute("aria-checked", "false");

  // Leave the companion re-enabled so a shared-state run ends in the default
  // posture (fresh hermetic HOME boots enabled anyway, but be tidy).
  await afterReload.click();
  await expect(afterReload).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });
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
