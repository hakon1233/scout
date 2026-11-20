import { expect, test } from "@playwright/test";
import { PORT } from "./port";

// The companion build's side of public topics, the profile and saved stories:
// Browse explains that public topics live on hosted Scout, Profile keeps no
// profile but links the reader's stories, and a story saved for later shows
// under the Saved tab and not under Liked.

const ORIGIN = `http://127.0.0.1:${PORT}`;
const HEADLINE = "Quantum batteries double in density";

async function seedFeed(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scout.settings.v1",
      JSON.stringify({
        name: "",
        interests: [{ id: "int_energy", topic: "Energy" }],
      }),
    );
    window.localStorage.setItem(
      "scout.lastBrief.v1",
      JSON.stringify({
        id: "brief_saved_1",
        generatedAt: "2026-06-25T09:00:00.000Z",
        kind: "daily",
        interests: ["Energy"],
        topics: [{ topic: "Energy", status: "covered" }],
        markdown: "## Energy\n\nQuantum batteries double in density.",
        articles: [
          {
            id: "story_energy_1",
            title: "example.com — Quantum batteries double in density",
            url: "https://example.com/quantum-batteries",
            interest: "Energy",
            source: "example.com",
            text: "Researchers report a doubling of cell energy density.",
            body: "Lab cells hit **2x** the density of today's packs.",
            publishedAt: "2026-06-25T08:00:00.000Z",
          },
        ],
      }),
    );
  });
}

test("Browse in the companion says public topics live on hosted Scout", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/browse/`);
  await expect(page.getByText("Hosted Scout only")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});

test("Profile in the companion keeps no profile and links liked and saved stories", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/profile/`);
  await expect(page.getByText(/keeps no profile/)).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByRole("link", { name: "Saved for later" }).click();
  await expect(page).toHaveURL(/\/app\/liked\/\?tab=saved$/);
  await expect(page.getByText("Nothing saved yet")).toBeVisible();
  await page.getByRole("link", { name: "Liked", exact: true }).click();
  await expect(page.getByText("No liked stories yet")).toBeVisible();
});

test("a story saved for later shows under Saved, not Liked, and unsaves there", async ({
  page,
}) => {
  await seedFeed(page);
  await page.goto(`${ORIGIN}/app/`);
  await page.getByRole("heading", { name: HEADLINE }).click();
  await page.getByRole("button", { name: "Save for later" }).click();
  await expect(
    page.getByRole("button", { name: "Remove from saved" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.goto(`${ORIGIN}/app/liked/`);
  await expect(page.getByText("No liked stories yet")).toBeVisible();
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page.getByRole("heading", { name: HEADLINE })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: HEADLINE })).toBeVisible();
  await page.getByRole("button", { name: "Remove from saved" }).click();
  await expect(page.getByText("Nothing saved yet")).toBeVisible();
});
