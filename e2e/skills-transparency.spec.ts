import { expect, test, type Page } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Block any non-loopback request so the suite stays fully offline (matches the
// other specs). The skills page is pure client-rendered content parsed from the
// engine's canonical strings — it makes no network calls — so this is belt-and-
// braces.
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

// The two transparency sets, with the group titles the page is contracted to
// surface verbatim from the engine source (search-skills.ts / assembly-skills.ts).
// The page parser (src/lib/skills.ts) drops only the trailing colon and keeps any
// parenthetical aside — these strings are exactly what should render. If the
// engine renames or drops a group, this list must be updated *together with* the
// source, which is the whole point: the page promises to stay honest to source.
const RESEARCH = {
  heading: "Search skills — mandatory rules for every topic",
  groups: [
    "RECENCY (the whole point of this brief)",
    "PUBLISH DATES (one per item, mandatory, captured as a field — not buried in link text)",
    "SOURCE IMAGE (one per item, OPTIONAL, handpicked from the source — never invented)",
    "IN-DEPTH BODY (one per item, render contract for the click-through detail — PER-214/PER-256/PER-265)",
    "SOURCES & QUALITY",
  ],
};
const ASSEMBLY = {
  heading: "Article-assembly skills — how Scout builds your brief",
  groups: [
    "ONE SECTION PER INTEREST",
    "NEWEST FIRST, ALWAYS",
    "HONEST COVERAGE (covered / nothing-new / didn't-come-back)",
    "FRESHNESS ENFORCED, NOT JUST REQUESTED",
    "DATED AND SOURCED",
  ],
};

// AIR-340: the in-development /app/skills transparency page (PER-212) had no e2e
// coverage. It renders the engine's REAL skill strings parsed into titled group
// cards — its whole value is being honest to source, so the regressions that
// matter are "a group silently disappears" or "a card renders with no bullets"
// (the parser dropped content but the heading survived, so the page lies).

test("Skills is reachable from the profile menu", async ({ page }) => {
  await blockNonLoopback(page);

  await page.goto(`${ORIGIN}/app/`);
  await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("menuitem", { name: "Skills" }).click();

  await expect(page).toHaveURL(`${ORIGIN}/app/skills/`, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Scout's skills" }),
  ).toBeVisible();
  await expect(page.getByText("In development")).toBeVisible();
});

test("both engine skill sets render with every group, and no group card is empty", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.goto(`${ORIGIN}/app/skills/`);

  for (const set of [RESEARCH, ASSEMBLY]) {
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { level: 2, name: set.heading }),
    });
    await expect(section).toHaveCount(1);

    for (const title of set.groups) {
      // The group title renders as the card's header <p>; its parent <div> is the
      // Card, which must also contain the group's bullet list. A header with an
      // empty card means the parser dropped the bullets — the page would claim a
      // skill exists while showing nothing under it.
      const header = section.getByText(title, { exact: true });
      await expect(header).toBeVisible();
      const card = header.locator("xpath=..");
      await expect(
        card.getByRole("listitem").first(),
        `group "${title}" should render at least one bullet`,
      ).toBeVisible();
    }
  }

  // Content sanity: representative bullets from each set actually render, proving
  // the parser kept bullet text (not just the ALL-CAPS headers).
  await expect(
    page.getByText(
      "NEVER silently present months-old articles as if they were current news.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Every story carries its real publish date, a one-sentence summary of what",
    ),
  ).toBeVisible();

  // The PUBLISH DATES group carries an indented wire-format sample that the
  // parser attaches as a bullet "detail" block — assert that continuation-line
  // path renders too (regression guard for the indent-detection branch).
  await expect(page.getByText("one-sentence summary of what happened.").first()).toBeVisible();

  await page.screenshot({
    path: "e2e/.artifact/skills-transparency.png",
    fullPage: true,
  });
});
