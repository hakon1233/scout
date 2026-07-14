import { expect, test, type Page } from "@playwright/test";

// AIR-679 (Browser QA pass) — `classifyError` (src/lib/errors.ts) and
// `ErrorBanner` (src/components/ErrorBanner.tsx) exist specifically to tell a
// real companion rejection apart from a network/reachability failure, and to
// surface the companion's own message instead of a generic one. That pairing
// has ZERO test coverage anywhere in the repo (no unit test for either file,
// no e2e spec that ever drives an errored "Run now"): every existing spec
// either exercises the happy path or a network-unreachable state. de773d1
// ("fix(connect): surface companion rejections") landed the same fix for the
// *Connect page's* `handleGenerate` — but that call site is provably
// unreachable in normal use (navigation-history.spec.ts proves the paired
// Connect route auto-redirects to /app/ before a user could act on it). The
// live, everyday "Run now" path (profile menu → generate() → postInterests)
// funnels every error through this exact classifyError/ErrorBanner pair and
// had no equivalent proof.
//
// The companion's two real structured-rejection shapes for POST /v0/interests
// are already unit/contract-tested server-side (packages/agent/test/contract.test.ts):
// the single-flight "brief in progress" 409, and the PER-240 wipe-guard 409
// (dropping a currently-saved topic without confirm_replace). What's untested
// is whether the BROWSER actually renders those real shapes correctly instead
// of collapsing them to "Could not reach Scout." We fulfil the POST with the
// exact real response bodies handlePostInterests would send (see
// packages/agent/src/routes/interests.ts), rather than reimplementing the
// companion — this proves the frontend contract, not the backend one (already
// covered elsewhere).
//
// Fully offline and deterministic: the companion is real (started by
// playwright.config's webServer) and reachable, but the one POST under test is
// intercepted so no `claude` shell-out and no real synthesis run happens.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function seedPairedSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "E2E Tester",
        interests: [{ id: "int_0_runnow", topic: "Run-now error surfacing topic" }],
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
      body: JSON.stringify({ error: "brief in progress", brief_id: "brief_test" }),
    });
  });

  await clickRunNow(page);

  // classifyError's fallback branch keeps the companion's own message verbatim
  // (postInterests throws `new Error(err.hint ?? err.error)` — no hint here, so
  // "brief in progress" survives untouched) UNLESS it matches the network-style
  // keyword test — "brief in progress" does not, so this must render as an
  // "unknown"-kind danger banner, never the generic network copy.
  await expect(page.getByText("brief in progress", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Couldn't reach Scout. Check your connection."),
  ).toHaveCount(0);

  // The "unknown"-kind ErrorBanner branch specifically (not "network", which
  // only ever offers "Try again" — "Copy details" only exists on this branch).
  await expect(page.getByRole("button", { name: "Copy details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Run now's wipe-guard rejection tells the user to pass confirm_replace, a control that does not exist on this page", async ({
  page,
}) => {
  await seedPairedSession(page);

  // The exact body handlePostInterests sends when this browser's saved-interest
  // snapshot is missing a topic the companion currently has saved (PER-240) —
  // realistic whenever the companion has been paired from more than one
  // browser/device (the Connect page's own "Set Scout up on another machine"
  // section documents this as a supported setup) and this browser's local copy
  // hasn't reconciled the other device's edit yet. Already proven real by
  // contract.test.ts's "replace would drop saved interests" case.
  const wipeGuardBody = {
    error: "replace would drop saved interests",
    dropped: ["Some other device's topic"],
    hint: "This endpoint replaces the whole saved list. Pass confirm_replace:true to intentionally drop these, or ephemeral:true (POST only) for a test run that persists nothing.",
  };
  await page.route(`${ORIGIN}/v0/interests`, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify(wipeGuardBody),
    });
  });

  await clickRunNow(page);

  // postInterests prefers `err.hint` over `err.error`, so the RAW API
  // instruction — not the founder-facing "replace would drop saved interests"
  // summary — is what actually reaches the screen.
  const banner = page.getByText(/Pass confirm_replace:true/);
  await expect(banner).toBeVisible();

  // The no-dead-control contract this codebase otherwise holds itself to
  // (PER-139, explicitly named in chat-actions.spec.ts) is broken here: the
  // banner's own copy names a `confirm_replace` escape hatch, but no control on
  // this page can send it. "Try again" is the ONLY affordance, and it just
  // re-fires the identical request — proven by pressing it and observing the
  // exact same rejection come back, not a different outcome.
  await expect(page.getByRole("button", { name: "Ephemeral" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /confirm/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Pass confirm_replace:true/)).toBeVisible();
});
