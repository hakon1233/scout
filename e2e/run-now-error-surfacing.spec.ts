import { expect, test, type Page } from "@playwright/test";
import { PORT } from "./port";

// How a refused "Run now" reaches the reader: the companion's real refusal
// bodies for POST /v0/interests, fulfilled in the browser so no run starts.

const ORIGIN = `http://127.0.0.1:${PORT}`;

async function seedPairedSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "E2E Tester",
        interests: [
          { id: "int_0_runnow", topic: "Run-now error surfacing topic" },
        ],
      }),
    );
    window.localStorage.setItem("scout.theme", "light");
  });
  await page.goto(`${ORIGIN}/app/`);
  // Same-origin auto-adopt (as zero-prompt.spec.ts): the pairing prompt must be
  // gone before "Run now" is reachable at all.
  await expect(page.getByRole("link", { name: /Pair companion/i })).toHaveCount(
    0,
  );
}

async function clickRunNow(page: Page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  const runNow = page.getByRole("button", { name: "Run now" });
  await expect(runNow).toBeEnabled({ timeout: 15_000 });
  await runNow.click();
}

test("Run now surfaces a real single-flight rejection verbatim, not a generic reachability message", async ({
  page,
}) => {
  await seedPairedSession(page);

  // The exact body handlePostInterests sends for a race against an in-flight
  // run (packages/agent/src/routes/interests.ts, no `hint` field on this one) —
  // already proven real by contract.test.ts's "second kick ... 409"s case.
  await page.route(`${ORIGIN}/v0/interests`, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "brief in progress",
        brief_id: "brief_test",
      }),
    });
  });

  await clickRunNow(page);

  // classifyError's fallback branch keeps the companion's own message verbatim
  // (postInterests throws `new Error(err.hint ?? err.error)` — no hint here, so
  // "brief in progress" survives untouched) UNLESS it matches the network-style
  // keyword test — "brief in progress" does not, so this must render as an
  // "unknown"-kind danger banner, never the generic network copy.
  await expect(
    page.getByText("brief in progress", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Couldn't reach Scout. Check your connection."),
  ).toHaveCount(0);

  // The "unknown"-kind ErrorBanner branch specifically (not "network", which
  // only ever offers "Try again" — "Copy details" only exists on this branch).
  await expect(
    page.getByRole("button", { name: "Copy details" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Run now's wipe-guard refusal tells the user what to do, not the API flag", async ({
  page,
}) => {
  await seedPairedSession(page);

  // The body POST /v0/interests sends when this browser's list is missing an
  // interest the companion has saved (added from another browser or the chat).
  await page.route(`${ORIGIN}/v0/interests`, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "replace would drop saved interests",
        dropped: ["Some other device's topic"],
        hint: "This endpoint replaces the whole saved list. Pass confirm_replace:true to intentionally drop these, or ephemeral:true (POST only) for a test run that persists nothing.",
      }),
    });
  });

  await clickRunNow(page);

  await expect(
    page.getByText(/Your interests changed somewhere else/),
  ).toBeVisible();
  await expect(page.getByText(/confirm_replace/)).toHaveCount(0);
});
