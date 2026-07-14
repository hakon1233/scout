import { expect, test } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The legacy `/app/chat` route (PER-228 follow-up) is a "Chat moved" stub:
// it mounts, then `router.replace(`/app/interests${window.location.search}`)`
// immediately forwards the user on, carrying the FULL query string along
// (not just a fixed target like profile-redirect.spec.ts's /app/profile ->
// /app/settings). This is the one legacy redirect in the suite that forwards
// a query string, and it had zero coverage before this spec — unlike
// /app/profile (profile-redirect.spec.ts) and /app/interests's own ?id=
// deep-link (interests-deeplink.spec.ts), both already covered.
//
// Two user-facing guarantees this guards:
//   1. a bare `/app/chat` bookmark forwards to the live Interests page and it
//      actually renders (not just a URL swap), and
//   2. `/app/chat?focus=<key>` (an old chat deep link) forwards to
//      `/app/interests?focus=<key>` AND the query survives Next's
//      `trailingSlash: true` static-export rewrite intact enough that
//      useProfileWorkbench's mount-time `params.get("focus")` actually picks
//      it up — i.e. the redirect doesn't just change the URL, it lands the
//      user on the exact card already marked focused, same as if they'd
//      clicked "Refine" themselves.
// Fully offline against the mock seed (id=ai-policy -> "AI policy &
// regulation"); no companion data, no paid scrape.
test.describe("legacy /app/chat redirect", () => {
  test("forwards to /app/interests and the Interests page renders", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/chat/`);

    await expect(page).toHaveURL(`${ORIGIN}/app/interests/`, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", { name: "Interests", level: 2 }),
    ).toBeVisible();
    await expect(page.getByLabel("Chat with Scout")).toBeVisible();

    // The "Chat moved" stub itself must not linger behind the redirect.
    await expect(page.getByText("Chat moved")).toBeHidden();
  });

  test("?focus= survives the redirect and actually focuses the matching card", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/app/chat/?mock=1&focus=ai-policy`);

    // The replace lands on Interests, query intact.
    await expect(page).toHaveURL(
      `${ORIGIN}/app/interests/?mock=1&focus=ai-policy`,
      { timeout: 15_000 },
    );

    // THE assertion: this is not just a URL match — useProfileWorkbench's
    // mount effect actually read `focus` off the forwarded query and set
    // focusKey, so the AI policy card renders already toggled into its
    // "Editing" (focused) state, exactly as InterestDocCard.tsx renders a
    // focused card (aria-pressed + "Editing" label on the toggle button).
    const card = page.getByLabel("Interest: AI policy & regulation");
    await expect(card).toBeVisible();
    const toggle = card.getByRole("button", { name: "Editing" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("uses replace(), so browser Back does not re-trap on /app/chat", async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}/`);
    await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
    await page.goto(`${ORIGIN}/app/chat/`);

    await expect(page).toHaveURL(`${ORIGIN}/app/interests/`, {
      timeout: 15_000,
    });

    await page.goBack();
    await expect(page).not.toHaveURL(/\/app\/chat\b/);
    await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });
  });
});
