import { expect, test } from "@playwright/test";
import { PORT } from "./port";

// The companion's chat (local mode): no mic even where the browser could
// record, since voice is a hosted Worker route; and a how-to answer offers an
// allow-listed page of the app. The stub `claude` answers "How do I …"
// questions with a reply and `page: "/app/settings/"`.

const ORIGIN = `http://127.0.0.1:${PORT}`;

test("local chat has no mic, and a how-to answer links to its page", async ({
  page,
}) => {
  // A browser that could record: MediaRecorder and getUserMedia both exist.
  await page.addInitScript(() => {
    class FakeRecorder {}
    Object.defineProperty(window, "MediaRecorder", { value: FakeRecorder });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => ({}) },
    });
  });
  await page.goto(`${ORIGIN}/app/interests/`);

  const composer = page.getByLabel("Message Scout");
  await expect(composer).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record a voice message" }),
  ).toHaveCount(0);

  await composer.fill("How do I get notified about new briefs?");
  await page.getByRole("button", { name: "Send" }).click();
  const link = page.getByRole("link", { name: "Open Settings" });
  // A stub chat turn can take a while once earlier specs filled the transcript.
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(link).toHaveAttribute("href", /\/app\/settings\/$/);
});
