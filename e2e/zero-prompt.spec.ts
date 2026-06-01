import { expect, test } from "@playwright/test";

// PER-119 — headless E2E that boots the BUILT/packed @scout/agent artifact and
// proves the zero-prompt first-run core loop end-to-end, deterministically and
// offline:
//
//   1. The companion (started by playwright.config webServer) serves the app
//      from its own loopback origin http://127.0.0.1:47821/app/.
//   2. Loading /app/ requires NO token-paste step — the token is auto-adopted
//      same-origin via GET /v0/config, so the "Pair companion" prompt never
//      shows and Generate becomes enabled on its own.
//   3. A brief renders in-app with citations and no preamble leak (the stub
//      claude emits a leading "I have enough…" line that stripBriefPreamble
//      must remove — PER-113 #1).
//   4. /v0/config is same-origin-guarded: same-origin → 200, cross-origin → 403.
//
// Determinism/offline: the claude shell-out is stubbed (SCOUT_CLAUDE_BIN), and
// every non-loopback request is blocked below, so the suite needs no real
// Anthropic/Exa key, no quota, and no network.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Belt-and-suspenders offline guard: abort any request that isn't to the
// loopback companion (e.g. the favicon service BriefView pulls from google.com).
// If the app ever depends on a remote during the core loop, this fails loudly.
async function blockNonLoopback(page: import("@playwright/test").Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return route.continue();
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return route.continue(); // data:, blob:, about: — harmless
    }
    return route.abort();
  });
}

test("zero-prompt first run: no paste, brief renders with citations, no preamble leak", async ({
  page,
}, testInfo) => {
  await blockNonLoopback(page);

  // Fresh profile (Playwright gives each test a clean context → empty
  // localStorage), loaded straight from the companion's own origin.
  await page.goto(`${ORIGIN}/app/`);

  // First run shows the setup wizard (no stored settings). Complete it.
  await page.getByLabel("Your name").fill("E2E Tester");
  await page.getByLabel(/Interests/).fill("AI safety\nMarkets");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: keys are optional — leave blank (companion path) and continue.
  await page.getByRole("button", { name: "Save and continue" }).click();

  // THE zero-prompt assertion: with no paste step, the token is auto-adopted
  // same-origin and the companion ping succeeds, so Generate enables itself.
  const generate = page.getByRole("button", { name: "Generate brief" });
  await expect(generate).toBeEnabled({ timeout: 15_000});

  // The "Pair companion" prompt (shown only when !companionReady) must be gone —
  // if same-origin auto-adoption regressed, this banner/link would reappear and
  // the user would be forced through /app/connect to paste a token.
  await expect(page.getByRole("link", { name: /Pair companion/i })).toHaveCount(0);
  await expect(page.getByText(/scout-agent run/)).toHaveCount(0);

  // Generate and wait for the brief to render in-app.
  await generate.click();

  // The stub brief has a `## AI safety` topic heading → BriefView renders it as
  // an <h2>. (The `# Your brief` H1 is intentionally hidden by BriefView.)
  await expect(page.getByRole("heading", { name: "AI safety" })).toBeVisible({
    timeout: 30_000,
  });

  // Citations survive parse → render: the stub's [example.com — Alignment
  // update](https://example.com/alignment) must appear as a real link.
  await expect(
    page.locator('a[href="https://example.com/alignment"]').first(),
  ).toBeVisible();

  // No preamble leak: the stub's leading "I have enough to write the brief now."
  // line must be stripped before render (PER-113 #1).
  await expect(page.locator("body")).not.toContainText(
    "I have enough to write the brief",
  );

  // Capture a screenshot artifact regardless (on failure Playwright also keeps
  // its own; this gives a green-run baseline too).
  await testInfo.attach("brief", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("/v0/config is same-origin guarded: 200 same-origin, 403 cross-origin", async ({
  request,
}) => {
  // Same-origin (Origin header matches the loopback origin) → 200 + token.
  const same = await request.get(`${ORIGIN}/v0/config`, {
    headers: { origin: ORIGIN },
  });
  expect(same.status()).toBe(200);
  const cfg = (await same.json()) as { token?: string };
  expect(typeof cfg.token).toBe("string");
  expect((cfg.token ?? "").length).toBeGreaterThan(0);

  // Cross-origin (a non-loopback Origin) → 403. This is the guard that keeps a
  // malicious web page from reading the local pairing token (PER-110).
  const cross = await request.get(`${ORIGIN}/v0/config`, {
    headers: { origin: "http://evil.example.com" },
  });
  expect(cross.status()).toBe(403);
});
