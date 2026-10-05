import { expect, test, type Page } from "@playwright/test";
import { PORT } from "./port";

// Retry after a failed chat turn, end to end against the real companion: the
// stub `claude` exits nonzero on the __FAIL_CHAT_TURN__ marker, so the turn
// lands failed with a real error message.

const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOPIC = "Baltic offshore wind permitting";
const FAIL_MARKER = "__FAIL_CHAT_TURN__";

// Send one chat message through the real composer. Waits for the Send affordance
// (swapped for Stop while a turn is in flight) so turns never overlap — the
// companion is single-flight and would 409 a second kick.
async function sendMessage(page: Page, text: string) {
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const composer = page.getByLabel("Message Scout");
  await composer.click();
  await composer.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("a failed turn gets its own Retry, which re-runs that message; replies that changed something offer none", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  await sendMessage(page, `Create an interest about ${TOPIC}`);
  const created = page
    .locator(".group\\/msg", { hasText: `Created · ${TOPIC}` })
    .first();
  await expect(created).toBeVisible({ timeout: 30_000 });

  const message = `Anything new to report? ${FAIL_MARKER}`;
  await sendMessage(page, message);
  const log = page.locator(
    '[role="log"][aria-label="Conversation with Scout"] > div > *',
  );
  await expect(log.last()).toContainText("I couldn't finish that turn:", {
    timeout: 30_000,
  });
  await expect(log.last()).toContainText("Something went wrong. Try again.");
  // Re-running a turn that already changed something would apply it twice.
  await expect(created.getByRole("button", { name: "Copy" })).toHaveCount(1);
  await expect(created.getByRole("button", { name: "Retry" })).toHaveCount(0);

  await log.last().getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
    timeout: 30_000,
  });
  // The retry re-ran the same message: no second bubble for it, a fresh
  // failure after it, and the earlier create was not run again.
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(log.last()).toContainText("I couldn't finish that turn:");
  const rail = page.getByRole("link", { name: `Interest: ${TOPIC}` });
  await expect(rail).toHaveCount(1);

  // Leave the shared companion as we found it.
  await sendMessage(page, `Delete ${TOPIC}`);
  const confirm = page
    .getByRole("alertdialog")
    .filter({ hasText: `Confirm delete · ${TOPIC}` })
    .last();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(rail).toHaveCount(0, { timeout: 30_000 });
});
