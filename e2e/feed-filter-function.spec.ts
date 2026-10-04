import { expect, test } from "@playwright/test";
import { PORT } from "./port";

// The feed filter narrows the feed to one topic (matching headings
// case-insensitively), applies to older day sections, and "All topics" restores it.

const ORIGIN = `http://127.0.0.1:${PORT}`;

function rawBrief(
  id: string,
  generatedAt: string,
  label: string,
): Record<string, unknown> {
  return {
    id,
    status: "ready",
    generated_at: generatedAt,
    summary_md: [
      "## AI safety",
      `- AI update from ${label}.`,
      `  [example.com — AI ${label}](https://example.com/ai-${id})`,
      "",
      "## Markets",
      `- Markets update from ${label}.`,
      `  [example.org — Markets ${label}](https://example.org/markets-${id})`,
    ].join("\n"),
    topics: [
      { topic: "AI safety", status: "covered" },
      { topic: "Markets", status: "covered" },
    ],
  };
}

const MULTI_DAY_BRIEFS = [
  rawBrief("filter-current", "2026-07-19T05:00:00.000Z", "current"),
  rawBrief("filter-day-1", "2026-07-18T05:00:00.000Z", "day 1"),
  rawBrief("filter-day-2", "2026-07-17T05:00:00.000Z", "day 2"),
  rawBrief("filter-day-3", "2026-07-16T05:00:00.000Z", "day 3"),
  rawBrief("filter-day-4", "2026-07-15T05:00:00.000Z", "day 4"),
];

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
      return route.continue(); // data:, blob:, about: — harmless
    }
    return route.abort();
  });
}

test("feed filter matches model topic headings case-insensitively", async ({
  page,
}) => {
  await blockNonLoopback(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("scout.theme", "light");
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "Filter Tester",
        interests: [
          { id: "int_openai", topic: "openai" },
          { id: "int_energy", topic: "Energy" },
        ],
      }),
    );
    window.localStorage.setItem(
      "scout.lastBrief.v1",
      JSON.stringify({
        id: "case-brief",
        generatedAt: "2026-06-20T08:00:00.000Z",
        interests: ["openai", "Energy"],
        markdown: "",
        articles: [
          {
            id: "case-brief-0",
            title: "example.com — OpenAI launches a research preview",
            url: "https://example.com/openai-preview",
            source: "example.com",
            publishedAt: "2026-06-20",
            interest: "OpenAI",
            text: "The model heading used title case.",
          },
          {
            id: "case-brief-1",
            title: "example.com — Grid batteries scale up",
            url: "https://example.com/grid-batteries",
            source: "example.com",
            publishedAt: "2026-06-19",
            interest: "Energy",
            text: "A separate topic should be hidden by the filter.",
          },
        ],
      }),
    );
  });

  await page.goto(`${ORIGIN}/app/`);
  await page.getByRole("button", { name: "Filter feed" }).click();
  await page
    .getByRole("group", { name: "Filter by topic" })
    .getByRole("button", { name: "openai" })
    .click();

  await expect(
    page.getByRole("heading", { name: "OpenAI launches a research preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Grid batteries scale up" }),
  ).toHaveCount(0);
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`feed filter applies to loaded and newly loaded day sections at ${viewport.name} width`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await blockNonLoopback(page);

    await page.route("**/v0/briefs?*", async (route) => {
      const url = new URL(route.request().url());
      const since = url.searchParams.get("since");
      if (since !== null) {
        await route.fulfill({ json: { briefs: [MULTI_DAY_BRIEFS[0]] } });
        return;
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 3);
      await route.fulfill({
        json: {
          briefs: MULTI_DAY_BRIEFS.slice(offset, offset + limit),
          total: MULTI_DAY_BRIEFS.length,
        },
      });
    });

    await page.addInitScript(
      (currentBrief) => {
        window.localStorage.setItem("scout.theme", "light");
        window.localStorage.setItem(
          "scout.companion.token",
          "filter-test-token",
        );
        window.localStorage.setItem(
          "scout.settings.v1",
          JSON.stringify({
            name: "Filter Tester",
            interests: [
              { id: "int_ai_safety", topic: "AI safety" },
              { id: "int_markets", topic: "Markets" },
            ],
          }),
        );
        window.localStorage.setItem(
          "scout.lastBrief.v1",
          JSON.stringify(currentBrief),
        );
      },
      {
        id: "filter-current",
        generatedAt: "2026-07-19T05:00:00.000Z",
        interests: ["AI safety", "Markets"],
        markdown: "",
        topics: [
          { topic: "AI safety", status: "covered" },
          { topic: "Markets", status: "covered" },
        ],
        articles: [
          {
            id: "filter-current-0",
            title: "example.com — AI current",
            url: "https://example.com/ai-filter-current",
            interest: "AI safety",
            text: "AI update from current.",
          },
          {
            id: "filter-current-1",
            title: "example.org — Markets current",
            url: "https://example.org/markets-filter-current",
            interest: "Markets",
            text: "Markets update from current.",
          },
        ],
      },
    );

    await page.goto(`${ORIGIN}/app/`);
    await expect(page.getByRole("heading", { name: "AI day 3" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", { name: "Markets day 3" }),
    ).toBeVisible();

    await testInfo.attach(`multi-day-unfiltered-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "Filter feed" }).click();
    await page
      .getByRole("group", { name: "Filter by topic" })
      .getByRole("button", { name: "Markets", exact: true })
      .click();

    await expect(page.getByRole("heading", { name: /^AI / })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^Markets / })).toHaveCount(
      4,
    );

    await page.getByRole("button", { name: "Filtering by Markets" }).click();
    await page
      .getByRole("group", { name: "Filter by topic" })
      .getByRole("button", { name: "AI safety", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /^Markets / })).toHaveCount(
      0,
    );
    await expect(page.getByRole("heading", { name: /^AI / })).toHaveCount(4);

    await page.getByRole("button", { name: "Load older briefs" }).click();
    await expect(page.getByRole("heading", { name: "AI day 4" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Markets day 4" }),
    ).toHaveCount(0);

    await testInfo.attach(`multi-day-filtered-after-load-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "Filtering by AI safety" }).click();
    await page
      .getByRole("group", { name: "Filter by topic" })
      .getByRole("button", { name: "All topics" })
      .click();
    await expect(page.getByRole("heading", { name: /^AI / })).toHaveCount(5);
    await expect(page.getByRole("heading", { name: /^Markets / })).toHaveCount(
      5,
    );
  });
}
