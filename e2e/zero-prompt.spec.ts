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

  // Seed the interest set before the app boots. The in-page keyword setup form
  // was removed in PER-188 — interests are now set via the chat-driven profile,
  // which a hermetic stub run can't drive. Seeding localStorage (the exact shape
  // saveSettings writes) reproduces the post-setup precondition directly, so the
  // test exercises the part that matters here: the zero-prompt run + feed render.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "E2E Tester",
        interests: [{ id: "int_0_aisafety", topic: "AI safety" }],
      }),
    );
  });

  // Loaded straight from the companion's own origin.
  await page.goto(`${ORIGIN}/app/`);

  // THE zero-prompt assertion: with no paste step, the token is auto-adopted
  // same-origin and the companion ping succeeds. The "Pair companion" prompt
  // (shown only when !companionReady) must be gone — if same-origin
  // auto-adoption regressed, this banner/link would reappear and the user would
  // be forced through /app/connect to paste a token. This toHaveCount(0) also
  // gates on the companion becoming ready before we fire the run (PER-219 moved
  // Run-now into the profile menu, so its disabled-state no longer encodes
  // readiness — the pairing prompt's disappearance is the readiness signal now).
  await expect(page.getByRole("link", { name: /Pair companion/i })).toHaveCount(0);
  await expect(page.getByText(/scout-agent run/)).toHaveCount(0);

  // Run-now lives in the profile menu now (PER-219 AC3). Open it and fire the run.
  await page.getByRole("button", { name: "Open settings" }).click();
  const generate = page.getByRole("menuitem", { name: "Run now" });
  await expect(generate).toBeEnabled({ timeout: 15_000 });

  // Generate and wait for the brief to render in-app.
  await generate.click();

  // The brief now renders as a news feed (PER-211): the stub's `## AI safety`
  // topic becomes a feed card whose headline is the citation title ("Alignment
  // update", from `[example.com — Alignment update](url)`). The card is a button.
  const card = page.getByRole("button", { name: /Alignment update/ });
  await expect(card).toBeVisible({ timeout: 30_000 });

  // The handpicked source image (the stub's `![source image](…)` line, pointed
  // at the companion's own loopback asset) parses and renders on the card —
  // proving the PER-211 image path end-to-end (capture contract → parser →
  // FeedImage), not just the text fallback.
  await expect(
    card.locator('img[src*="icon-192.png"]'),
  ).toBeVisible();

  // The feed stays SHORT (PER-214): the in-depth blockquote body must NOT leak
  // onto the feed card — depth appears only after a click.
  await expect(page.locator("body")).not.toContainText(
    "need replication on larger models",
  );

  // Clicking a card opens the detail, where the source link and the in-depth
  // body live. Citations survive parse → render as a real, safe link there, and
  // the source image carries through to the larger detail view.
  await card.click();
  await expect(
    page.locator('a[href="https://example.com/alignment"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('img[src*="icon-192.png"]').first(),
  ).toBeVisible();

  // The in-depth body (PER-214): the stub's `> …` blockquote paragraphs parse
  // into Article.body and render ONLY in this detail view, not on the feed card.
  // Prove a sentence that lives solely in the blockquote is now visible here.
  await expect(page.locator("body")).toContainText(
    "need replication on larger models",
  );

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
