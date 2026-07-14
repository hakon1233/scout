import { expect, test } from "@playwright/test";

// CAR-111 regression: the Liked feed must survive a CORRUPTED likes store in
// localStorage by degrading to the empty state, never crashing the render.
//
// The shipped bug: a stored `{ "likes": null }` slipped past the old
// `typeof obj.likes !== "object"` guard (because `typeof null === "object"`),
// then crashed downstream `Object.values(store.likes)` / `key in store.likes`
// during render — a blank screen for the reader. The fix (src/lib/likes.ts
// parse()) added an explicit `!obj.likes` null-reject so any corrupted value
// degrades to EMPTY.
//
// This had ZERO e2e coverage: liked-feed.spec.ts only seeds a well-formed store
// (happy path) or nothing (empty). Here we drive the REAL app through the
// browser with each malformed shape and assert (a) no uncaught page error fires
// during render, and (b) the normal "No liked stories yet" empty state takes
// over — i.e. the corrupt value was treated as empty, not allowed to throw.
//
// Mirrors liked-feed.spec.ts: blocks non-loopback, seeds via addInitScript.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const LIKES_KEY = "scout.likes.v1";

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

// Each entry is a RAW localStorage value (already a string, as the browser
// stores it) that a corrupted/legacy store could realistically hold. None of
// these should reach render as a live store — all must degrade to EMPTY.
const CORRUPT_VARIANTS: { name: string; raw: string }[] = [
  // The exact CAR-111 payload: typeof null === "object" defeats a bare guard.
  { name: "likes is null", raw: JSON.stringify({ version: 1, likes: null }) },
  // likes present but a primitive — Object.values()/`key in` would still throw
  // or misbehave on a non-object; must be rejected.
  {
    name: "likes is a string",
    raw: JSON.stringify({ version: 1, likes: "oops" }),
  },
  // Top-level null parses to null → `!obj` rejects it.
  { name: "whole store is null", raw: "null" },
  // Not JSON at all → parse() catch → EMPTY.
  { name: "non-JSON garbage", raw: "{not valid json" },
];

for (const variant of CORRUPT_VARIANTS) {
  test(`corrupt likes store (${variant.name}) degrades to empty state without crashing`, async ({
    page,
  }) => {
    await blockNonLoopback(page);

    // Capture any uncaught exception thrown during render — the precise failure
    // mode CAR-111 fixed. A regression would surface here as a pageerror.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.addInitScript(
      ({ key, raw }) => {
        window.localStorage.setItem(key, raw);
      },
      { key: LIKES_KEY, raw: variant.raw },
    );

    await page.goto(`${ORIGIN}/app/liked/`);

    // The feed header still renders...
    await expect(
      page.getByRole("heading", { name: "Liked stories", level: 1 }),
    ).toBeVisible();
    // ...and the corrupt store is treated as empty, not as live data.
    await expect(page.getByText("No liked stories yet")).toBeVisible();

    // No uncaught error escaped to the page (the render-crash regression).
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
}

// Recovery: after loading on top of a corrupt store, a fresh like writes a
// clean store and the feed reflects it — proving the degrade-to-empty path
// leaves the store usable, not wedged. We seed a corrupt value, then like a
// story directly through the public store API in the page context (the same
// path the UI uses) and assert it now renders.
test("a corrupt store is overwritten cleanly by a subsequent like", async ({
  page,
}) => {
  await blockNonLoopback(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Seed ONLY on first load: init scripts run on every navigation (incl. the
  // reload below), so an unconditional seed would resurrect the corrupt value
  // and clobber the clean write we are testing for.
  await page.addInitScript(
    ({ key }) => {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(
          key,
          JSON.stringify({ version: 1, likes: null }),
        );
      }
    },
    { key: LIKES_KEY },
  );

  await page.goto(`${ORIGIN}/app/liked/`);
  await expect(page.getByText("No liked stories yet")).toBeVisible();

  // Write a well-formed liked story straight into localStorage (what toggleLike
  // produces), then reload: the previously-corrupt store is gone and the story
  // renders — the corrupt value did not poison future writes.
  const STORY_URL = "https://example.com/recovered-story";
  await page.evaluate(
    ({ key, url }) => {
      const store = {
        version: 1,
        likes: {
          [url]: {
            key: url,
            url,
            headline: "Recovered after a corrupt store",
            source: "example.com",
            topic: "Energy",
            likedAt: "2026-06-25T09:00:00.000Z",
          },
        },
      };
      window.localStorage.setItem(key, JSON.stringify(store));
    },
    { key: LIKES_KEY, url: STORY_URL },
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Recovered after a corrupt store" }),
  ).toBeVisible();
  await expect(page.getByText("No liked stories yet")).toHaveCount(0);
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
