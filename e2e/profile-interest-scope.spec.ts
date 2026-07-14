import { expect, test, type Page } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The STANDALONE per-interest scope page at /app/profile/interest
// (src/app/app/profile/interest/page.tsx). This is a different route and a
// different component from the interests *workbench* drill-in that
// interests-deeplink.spec.ts covers (/app/interests?id=…, rendered inside the
// chat workbench). This page renders the scope view on its own chrome:
// "← Interests" / "Interest scope" header, ThemeToggle, and the
// "Refine in chat" / "Latest brief" footer pills.
//
// Everything here runs fully offline against the `?mock=` seed
// (SAMPLE_INTERESTS → id=ai-policy → "AI policy & regulation"). The mock seeds
// only doc *metadata* (hasDoc + updatedAt), never a doc body — so the page is
// contracted to show the honest "intent doc exists but no markdown in this
// session" line, NOT invented doc content. No companion data, no paid scrape.

// Belt-and-braces offline guard: abort any non-loopback request. The mock path
// is pure client render and makes no network calls, but a regression that
// quietly reaches for the companion/scrape would fail loudly here.
async function blockNonLoopback(page: Page) {
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

test.describe("standalone interest scope page", () => {
  test("deep-linking ?id= renders the scope view with the honest no-body doc state", async ({
    page,
  }) => {
    await blockNonLoopback(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${ORIGIN}/app/profile/interest/?mock=full&id=ai-policy`);

    // The standalone chrome — distinct from the workbench drill-in.
    await expect(page.getByRole("link", { name: "← Interests" })).toBeVisible();
    // AIR-441 renamed the chrome label "Interest scope" → "Assignment"; it is the
    // first of the two "Assignment" labels (chrome, then the header eyebrow).
    await expect(
      page.getByText("Assignment", { exact: true }).first(),
    ).toBeVisible();

    // The scope header + the seeded topic resolve from id → SAMPLE_INTERESTS.
    await expect(
      page.locator("header").getByText("Assignment", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI policy & regulation" }),
    ).toBeVisible();

    // mockDocMeta(seed="full") marks every interest hasDoc:true with a fixed
    // updatedAt → the dateline renders.
    await expect(page.getByText(/Assignment updated/)).toBeVisible();

    // THE honesty contract: the mock seeds metadata but no markdown body, so the
    // page must NOT fabricate doc content — it shows the explicit "didn't return
    // its markdown" line, and never an "No intent doc yet" empty state (that
    // would contradict hasDoc:true).
    await expect(
      page.getByText(
        "Scout has an assignment for this interest, but the companion did not return its markdown in this session.",
      ),
    ).toBeVisible();
    await expect(page.getByText("No assignment yet")).toBeHidden();

    // Footer navigation pills are present.
    await expect(
      page.getByRole("link", { name: "Refine in chat" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Latest brief" }),
    ).toBeVisible();
  });

  test("an unknown ?id= shows the 'Interest not found' empty state, not a crash", async ({
    page,
  }) => {
    await blockNonLoopback(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(
      `${ORIGIN}/app/profile/interest/?mock=full&id=this-interest-does-not-exist`,
    );

    // The id resolves to no interest → the guarded empty state, never a thrown
    // render (model is null, not undefined-access).
    await expect(
      page.getByRole("heading", { name: "Interest not found" }),
    ).toBeVisible();
    await expect(
      page.getByText("Return to Interests and open an interest from the list."),
    ).toBeVisible();

    // The scope header must NOT be on screen when nothing resolved.
    await expect(
      page.locator("header").getByText("Assignment", { exact: true }),
    ).toBeHidden();
  });

  test("the ← Interests control links back to the interests list", async ({
    page,
  }) => {
    await blockNonLoopback(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${ORIGIN}/app/profile/interest/?mock=full&id=ai-policy`);
    await expect(
      page.locator("header").getByText("Assignment", { exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "← Interests" }).click();
    await expect(page).toHaveURL(/\/app\/interests/);
  });
});
