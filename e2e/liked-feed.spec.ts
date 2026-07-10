import { expect, test } from "@playwright/test";

// PER-249: the like/save feature and its dedicated Liked feed. Mirrors
// feed-filter-theme.spec.ts: blocks non-loopback, seeds localStorage via
// addInitScript, and asserts the Scout dark tokens (the founder reads in dark
// mode) alongside the behavioural acceptance criteria — persistence across
// reload, the top-bar entry point, unlike-in-place, and the empty state.

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

// One canned liked story whose key === canonicalUrl(url) (no hash/query, no
// trailing slash), matching the store's keying.
const STORY_URL = "https://example.com/quantum-leap";
const SEED_STORE = {
  version: 1,
  likes: {
    [STORY_URL]: {
      key: STORY_URL,
      url: STORY_URL,
      headline: "A quantum leap in battery density",
      blurb: "Researchers report a doubling of energy density.",
      source: "example.com",
      topic: "Energy",
      publishedAt: "2026-06-10T00:00:00.000Z",
      likedAt: "2026-06-12T09:00:00.000Z",
    },
  },
};

test("liked feed renders saved stories with dark theme tokens", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.addInitScript(
    ({ key, store }) => {
      window.localStorage.setItem("scout.theme", "dark");
      window.localStorage.setItem(key, JSON.stringify(store));
    },
    { key: LIKES_KEY, store: SEED_STORE },
  );

  await page.goto(`${ORIGIN}/app/liked/`);
  await expect(page.locator("html")).toHaveClass(/dark/);

  await expect(
    page.getByRole("heading", { name: "Liked stories", level: 1 }),
  ).toBeVisible();

  // The seeded story's display snapshot renders even with no cached brief.
  await expect(
    page.getByRole("heading", { name: "A quantum leap in battery density" }),
  ).toBeVisible();

  // The topic chip uses the dark editorial signal red — #d2694c
  // (rgb(210,105,76)) after PER-264 lightened it from #c4553f for WCAG AA.
  await expect(page.getByText("Energy", { exact: true })).toHaveCSS(
    "color",
    "rgb(210, 105, 76)",
  );

  // The filled heart (this is the unlike control) carries the dark signal token
  // on text + border — proving dark mode is styled from the start.
  const unlike = page.getByRole("button", {
    name: "Remove from liked stories",
  });
  await expect(unlike).toHaveAttribute("aria-pressed", "true");
  await expect(unlike).toHaveCSS("color", "rgb(210, 105, 76)");
  await expect(unlike).toHaveCSS("border-color", "rgb(210, 105, 76)");
});

test("light mode keeps the established Scout tokens", async ({ page }) => {
  await blockNonLoopback(page);
  await page.addInitScript(
    ({ key, store }) => {
      window.localStorage.setItem("scout.theme", "light");
      window.localStorage.setItem(key, JSON.stringify(store));
    },
    { key: LIKES_KEY, store: SEED_STORE },
  );

  await page.goto(`${ORIGIN}/app/liked/`);
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await expect(page.getByText("Energy", { exact: true })).toHaveCSS(
    "color",
    "rgb(154, 59, 46)",
  );
  const unlike = page.getByRole("button", {
    name: "Remove from liked stories",
  });
  await expect(unlike).toHaveCSS("color", "rgb(154, 59, 46)");
});

test("unliking removes the story and persists across reload", async ({
  page,
}) => {
  await blockNonLoopback(page);
  // Seed ONLY on first load (init scripts run on every navigation, including the
  // reload below — an unconditional seed would resurrect the story and defeat
  // the persistence check).
  await page.addInitScript(
    ({ key, store }) => {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, JSON.stringify(store));
      }
    },
    { key: LIKES_KEY, store: SEED_STORE },
  );

  await page.goto(`${ORIGIN}/app/liked/`);
  await page.getByRole("button", { name: "Remove from liked stories" }).click();

  // Card disappears and the empty state takes over — optimistically, in place.
  await expect(
    page.getByRole("heading", { name: "A quantum leap in battery density" }),
  ).toHaveCount(0);
  await expect(page.getByText("No liked stories yet")).toBeVisible();

  // The store was actually rewritten (not just the DOM).
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    LIKES_KEY,
  );
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored as string).likes).toEqual({});

  // Survives a full reload — persistence, not just session state.
  await page.reload();
  await expect(page.getByText("No liked stories yet")).toBeVisible();
});

test("empty state shows when nothing is liked", async ({ page }) => {
  await blockNonLoopback(page);

  await page.goto(`${ORIGIN}/app/liked/`);
  await expect(page.getByText("No liked stories yet")).toBeVisible();
});

test("top-bar heart links to the liked feed from the app", async ({ page }) => {
  await blockNonLoopback(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({ name: "Reader", interests: [] }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);
  await page.getByRole("link", { name: "Liked stories" }).click();
  await expect(page).toHaveURL(/\/app\/liked\/?$/);
  await expect(
    page.getByRole("heading", { name: "Liked stories", level: 1 }),
  ).toBeVisible();
});
