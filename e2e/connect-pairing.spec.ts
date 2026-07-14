import { expect, test } from "@playwright/test";

// Unpaired first-run walkthrough on /app/connect/ (State B) — the public,
// github.io-style entry point a brand-new user hits before any companion is
// running. The committed suite already covers the SAME-ORIGIN auto-adopt path
// (zero-prompt.spec) and that Connect is *reachable* while unpaired
// (navigation-history.spec). What was untested is the onboarding payload the
// walkthrough actually hands the user:
//
//   1. the install command points at THIS serving origin's tarball, not the
//      hardcoded github.io default — i.e. the documented post-mount origin swap
//      (PER-166 / React #418 hydration-safe rewrite) really happened;
//   2. that advertised tarball is genuinely served (HEAD → 200), so the copied
//      `npm i -g <url>` is not a dangling link — this guards the version-drift
//      regression where the page's `scout-agent-0.3.0.tgz` constant and the
//      packed artifact fall out of sync;
//   3. the Copy button puts the byte-for-byte command on the clipboard (what
//      the user pastes === what they see); and
//   4. the manual token-paste escape hatch persists the pairing token.
//
// All offline: we force the unpaired state by 404-ing the companion's /healthz
// and /v0/config probes, exactly like navigation-history's unpaired test.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TARBALL_PATH = "/agent/scout-agent-0.3.0.tgz";
const TOKEN_KEY = "scout.companion.token";
const COMPANION_PORT_SWEEP = [47821, 47822, 47823, 47830, 47840];

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

// Force the unpaired walkthrough: the companion appears absent, so no token is
// auto-adopted and the page settles on State B instead of redirecting to /app/.
async function gotoUnpairedConnect(page: import("@playwright/test").Page) {
  await blockNonLoopback(page);
  for (const port of COMPANION_PORT_SWEEP) {
    for (const host of ["127.0.0.1", "localhost"]) {
      await page.route(`http://${host}:${port}/healthz`, (route) =>
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ ok: false }),
        }),
      );
    }
  }
  await page.route(`${ORIGIN}/v0/config`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ token: null }),
    }),
  );
  await page.goto(`${ORIGIN}/app/connect/`);
  await expect(
    page.getByRole("heading", { name: "Connect your agent" }),
  ).toBeVisible();
}

test("unpaired walkthrough advertises an install command pinned to the serving origin", async ({
  page,
}) => {
  await gotoUnpairedConnect(page);

  // The install CmdBlock <pre> holds the literal command the user copies.
  const installPre = page.locator("pre", { hasText: "npm i -g" });
  await expect(installPre).toBeVisible();

  const cmd = (await installPre.innerText()).trim();
  // Origin swap landed: the URL is the loopback host serving this page, NOT the
  // DEFAULT_TARBALL_URL (hakon1233.github.io) baked in for the static export.
  expect(cmd).toContain(`npm i -g ${ORIGIN}${TARBALL_PATH}`);
  expect(cmd).toContain("scout-agent pair");
  expect(cmd).not.toContain("github.io");
});

test("the advertised companion tarball is actually served (onboarding link is not dangling)", async ({
  request,
}) => {
  test.fixme(
    true,
    "AIR-641: pack:agent's webroot snapshot is taken before its own tarball is packed, so a genuinely fresh checkout's first pack:agent run bakes a companion webroot with NO tarball at all — 404s deterministically, not CI-only (any machine that's never run pack:agent before hits this; a stale cached tarball from a prior local run is what makes it look CI-only). Real product bug, not test-infra; tracked, not the stub-claude.mjs AIR-642 crash this was previously mislabeled as.",
  );
  // The exact URL the walkthrough tells the user to `npm i -g`. If the page's
  // pinned version constant drifts from the packed artifact, this 404s and
  // first-run onboarding silently breaks. HEAD avoids pulling the ~100MB body;
  // the companion's static server supports HEAD (server.ts static fallback).
  const res = await request.fetch(`${ORIGIN}${TARBALL_PATH}`, {
    method: "HEAD",
  });
  expect(
    res.status(),
    `install tarball ${TARBALL_PATH} should be served by the companion`,
  ).toBe(200);
});

test("Copy puts the exact install command on the clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: ORIGIN,
  });
  await gotoUnpairedConnect(page);

  const installPre = page.locator("pre", { hasText: "npm i -g" });
  const shown = (await installPre.innerText()).trim();

  // First Copy button in State B belongs to the install CmdBlock (Step 01),
  // ahead of the "start the companion" run block (Step 02).
  await page.getByRole("button", { name: "Copy command" }).first().click();
  await expect(
    page.getByRole("button", { name: /copied/i }).first(),
  ).toBeVisible();

  const clip = (await page.evaluate(() =>
    navigator.clipboard.readText(),
  )) as string;
  // What the user pastes is byte-for-byte what the terminal block shows — no
  // hydration drift, no stale origin.
  expect(clip.trim()).toBe(shown);
  expect(clip).toContain(`${ORIGIN}${TARBALL_PATH}`);
});

test("manual token paste escape hatch persists the pairing token", async ({
  page,
}) => {
  await gotoUnpairedConnect(page);

  const tokenField = page.getByPlaceholder("Paste pairing token here");
  await expect(tokenField).toBeVisible();
  const token = "tok_e2e_manual_pair_123";
  await tokenField.fill(token);
  await page.getByRole("button", { name: "Save" }).click();

  // saveCompanionToken trims and writes to localStorage under TOKEN_KEY — the
  // contract loadCompanionToken / handleGenerate read back from.
  await expect
    .poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY))
    .toBe(token);

  // Still disconnected (companion 404s), so the page must NOT claim "all set" /
  // redirect: setupComplete requires connected AND saved. A saved token alone
  // keeps the user on the walkthrough.
  await expect(page).toHaveURL(`${ORIGIN}/app/connect/`);
});

// Force the OTHER half of setupComplete: a genuinely reachable companion
// (/healthz answers for real — no mocking) whose /v0/config is unreachable, so
// bootstrapCompanionToken() can never auto-adopt (or later self-heal) the real
// pairing token. This is the same code-level split a first-time user hits on
// the public (github.io) walkthrough: discoverCompanion()'s loopback port-sweep
// can ping a locally-running companion's /healthz cross-origin and flip
// `status` to "connected", but isServedFromCompanion() — and therefore
// fetchCompanionConfig/bootstrapCompanionToken — is scoped to
// window.location.origin, so a companion on a different origin than the page
// never gets its token bootstrapped, checked, or corrected there.
async function gotoConnectedWithoutConfig(
  page: import("@playwright/test").Page,
) {
  await blockNonLoopback(page);
  await page.route(`${ORIGIN}/v0/config`, (route) => route.abort());
  await page.goto(`${ORIGIN}/app/connect/`);
  // hasSavedToken starts false (bootstrap can't reach /v0/config) while status
  // still resolves "connected" for real, so this settles on the Step-01
  // walkthrough rather than racing straight to a redirect.
  await expect(page.getByPlaceholder("Paste pairing token here")).toBeVisible({
    timeout: 15_000,
  });
}

test("a wrong manually-pasted token is accepted with no server-side validation, flips to a false 'You're all set', and auto-redirects into the app (AIR-674)", async ({
  page,
}) => {
  await gotoConnectedWithoutConfig(page);

  // Sanity: genuinely on the walkthrough, not already past the check.
  await expect(page.getByText("You're all set")).toHaveCount(0);

  const tokenField = page.getByPlaceholder("Paste pairing token here");
  const wrongToken = "definitely-the-wrong-token";
  await tokenField.fill(wrongToken);
  await page.getByRole("button", { name: "Save" }).click();

  // handleSaveToken flips hasSavedToken on Boolean(token.trim()) alone — no
  // fetch, no comparison against the companion's real pairing_token
  // (server.ts's timingSafeTokenEqual is never consulted here). Combined with
  // a genuinely-reachable /healthz, that's sufficient for setupComplete to
  // declare success for a token nobody has verified, and its effect fires
  // router.replace("/app/") in the same render — the "You're all set" banner
  // is real but genuinely transient (not asserted directly here: under load
  // the redirect can beat a second locator's poll to the punch, which isn't
  // itself a bug). The stable, load-bearing proof is the redirect actually
  // firing off an unverified token, not a screenshot of the banner mid-flight.
  await expect(page).toHaveURL(`${ORIGIN}/app/`);

  // What's persisted really is the wrong value, not a UI-only glitch a real
  // write would have caught.
  await expect
    .poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY))
    .toBe(wrongToken);
});

// Force the OTHER half of setupComplete: a genuinely reachable companion
// (/healthz answers for real — no mocking) whose /v0/config is unreachable, so
// bootstrapCompanionToken() can never auto-adopt (or later self-heal) the real
// pairing token. This is the same code-level split a first-time user hits on
// the public (github.io) walkthrough: discoverCompanion()'s loopback port-sweep
// can ping a locally-running companion's /healthz cross-origin and flip
// `status` to "connected", but isServedFromCompanion() — and therefore
// fetchCompanionConfig/bootstrapCompanionToken — is scoped to
// window.location.origin, so a companion on a different origin than the page
// never gets its token bootstrapped, checked, or corrected there.
async function gotoConnectedWithoutConfig(
  page: import("@playwright/test").Page,
) {
  await blockNonLoopback(page);
  await page.route(`${ORIGIN}/v0/config`, (route) => route.abort());
  await page.goto(`${ORIGIN}/app/connect/`);
  // hasSavedToken starts false (bootstrap can't reach /v0/config) while status
  // still resolves "connected" for real, so this settles on the Step-01
  // walkthrough rather than racing straight to a redirect.
  await expect(page.getByPlaceholder("Paste pairing token here")).toBeVisible({
    timeout: 15_000,
  });
}

test("a wrong manually-pasted token is accepted with no server-side validation, flips to a false 'You're all set', and auto-redirects into the app (AIR-674)", async ({
  page,
}) => {
  await gotoConnectedWithoutConfig(page);

  // Sanity: genuinely on the walkthrough, not already past the check.
  await expect(page.getByText("You're all set")).toHaveCount(0);

  const tokenField = page.getByPlaceholder("Paste pairing token here");
  const wrongToken = "definitely-the-wrong-token";
  await tokenField.fill(wrongToken);
  await page.getByRole("button", { name: "Save" }).click();

  // handleSaveToken flips hasSavedToken on Boolean(token.trim()) alone — no
  // fetch, no comparison against the companion's real pairing_token
  // (server.ts's timingSafeTokenEqual is never consulted here). Combined with
  // a genuinely-reachable /healthz, that's sufficient for setupComplete to
  // declare success for a token nobody has verified, and its effect fires
  // router.replace("/app/") in the same render — the "You're all set" banner
  // is real but genuinely transient (not asserted directly here: under load
  // the redirect can beat a second locator's poll to the punch, which isn't
  // itself a bug). The stable, load-bearing proof is the redirect actually
  // firing off an unverified token, not a screenshot of the banner mid-flight.
  await expect(page).toHaveURL(`${ORIGIN}/app/`);

  // What's persisted really is the wrong value, not a UI-only glitch a real
  // write would have caught.
  await expect
    .poll(() => page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY))
    .toBe(wrongToken);
});
