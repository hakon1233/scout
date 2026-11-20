import { expect, test, type Page } from "@playwright/test";
import { PORT } from "./port";

// The topic page's Brief group writes the topic's brief settings through
// PUT /v0/interest-settings, and they are still there after a reload (read
// back from GET /v0/interests).

const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOPIC = "Brief settings e2e topic";

// Adds TOPIC to the companion's saved topics without starting a run (PUT is
// persist-only) and returns its id.
async function seedTopic(page: Page): Promise<string> {
  return page.evaluate(async (topic) => {
    const token = localStorage.getItem("scout.companion.token") ?? "";
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    type Row = { id: string; topic: string };
    const read = async () =>
      (
        (await (await fetch("/v0/interests", { headers })).json()) as {
          interests: Row[];
        }
      ).interests;
    const topics = (await read()).map((i) => i.topic);
    if (!topics.includes(topic)) {
      const res = await fetch("/v0/interests", {
        method: "PUT",
        headers,
        body: JSON.stringify({ interests: [...topics, topic] }),
      });
      if (!res.ok) throw new Error(`seed failed: ${res.status}`);
    }
    const found = (await read()).find((i) => i.topic === topic);
    if (!found) throw new Error("seeded topic missing");
    return found.id;
  }, TOPIC);
}

test("topic page: brief length and story count save to the companion and survive a reload", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("scout.theme", "light"),
  );
  // Pair same-origin first, so the token is in localStorage.
  await page.goto(`${ORIGIN}/app/`);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("scout.companion.token")),
    )
    .toBeTruthy();
  const id = await seedTopic(page);

  await page.goto(`${ORIGIN}/app/interests/?id=${encodeURIComponent(id)}`);
  await expect(
    page.getByRole("heading", { name: TOPIC, level: 1 }),
  ).toBeVisible({ timeout: 15_000 });

  const length = page.getByRole("radiogroup", { name: "Brief length" });
  const stories = page.getByLabel("How many stories");
  // The defaults: a medium brief with the top 4 stories.
  await expect(length.getByRole("radio", { name: "Medium" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(stories).toHaveValue("4");

  await length.getByRole("radio", { name: "Short" }).click();
  await expect(page.getByText("Saved. The next brief uses it.")).toBeVisible();
  await stories.selectOption("relevant");
  await expect(page.getByText("Only what matters, 0 to 4")).toBeVisible();
  await expect(page.getByText("Saved. The next brief uses it.")).toBeVisible();

  await page.reload();
  await expect(length.getByRole("radio", { name: "Short" })).toHaveAttribute(
    "aria-checked",
    "true",
    { timeout: 15_000 },
  );
  await expect(stories).toHaveValue("relevant");
});
