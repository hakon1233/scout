import { expect, test, type Page } from "@playwright/test";
import { PORT } from "./port";

// The Undo affordance on an auto-applied CREATE card, driven end-to-end against
// the REAL companion /v0/chat + confirm routes. chat-actions.spec already
// proves the create card RENDERS an "Applied" beat with an Undo button and that
// the doc lands in the rail — but it only asserts the Undo control is
// *visible*, never that it is *live*. A visible control that does nothing is
// exactly the dead-control failure the UI forbids, so this spec presses it and
// follows the whole reversal through to the rail.
//
// The honest reversal channel (useProfileWorkbench.undo) is NOT a magic server
// rollback: undoing a create sends a normal "Delete the interest you just
// created" turn. Because deletes are confirm-gated, that reversing turn
// surfaces a fresh [Delete]/[Cancel] card — pressing Delete hits the
// deterministic confirm-delete route and removes the interest for good. So the
// full live path is: Applied+Undo → "Undo sent" → Confirm delete card → Delete →
// gone from rail → and STAYS gone across a reload (durable, not just FE-local).
//
// Fully offline and deterministic: the stub `claude` (e2e/fixtures/stub-claude.mjs)
// answers create by phrasing and the reversing "delete …" phrasing with a
// confirm-gated delete op keyed off the first snapshot id — no network, no
// Anthropic/Exa key, no quota.

const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOPIC = "GPU kernel scheduling";

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

test("chat Undo on a created interest is a live control: reverses through the confirm-delete route and persists", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  // ── CREATE — auto-applied, with a real Undo ───────────────────────────────
  await sendMessage(page, `Create an interest about ${TOPIC}`);

  // Scoped to THIS spec's own create-reply: the chat transcript is shared
  // across the whole suite (single companion instance, no per-spec reset), so
  // an unscoped `getByRole("button", {name:"Undo"})` becomes ambiguous once
  // enough other specs have left their own un-reversed "Applied"+Undo cards in
  // history. Scoping the locator keeps this spec from tripping over that.
  const createReply = page
    .locator(".group\\/msg", { hasText: `Created · ${TOPIC}` })
    .first();
  const undo = createReply.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Created · ${TOPIC}`)).toBeVisible();
  // The doc actually landed in the interest rail (confirmed write).
  const railLink = page.getByRole("link", { name: `Interest: ${TOPIC}` });
  await expect(railLink).toBeVisible();

  // ── PRESS UNDO — it is live, not decorative ───────────────────────────────
  // The button locks to "Undo sent" and the helper line flips, proving the click
  // dispatched a reversing turn rather than no-op'ing.
  await undo.click();
  await expect(page.getByRole("button", { name: "Undo sent" })).toBeVisible();
  await expect(page.getByText("Asked Scout to reverse this")).toBeVisible();

  // The reversing turn is a normal "delete that interest" turn, so deletes being
  // confirm-gated it surfaces a fresh confirm card for THIS topic — not
  // a silent rollback. Asserting the topic guards against the reversal targeting
  // the wrong interest.
  const confirm = page.getByRole("alertdialog").last();
  await expect(confirm.getByText(`Confirm delete · ${TOPIC}`)).toBeVisible({
    timeout: 30_000,
  });

  // ── CONFIRM — the real confirm-delete route removes it ────────────────────
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm.getByText("Removed from your interests")).toBeVisible({
    timeout: 30_000,
  });
  // The reversal landed: the created interest is gone from the rail.
  await expect(railLink).toBeHidden({ timeout: 30_000 });

  // ── DURABLE — the undo is server-side, survives a reload ──────────────────
  // A FE-only "hide" would reappear on reload; a real confirm-delete write does
  // not. This is the part chat-actions.spec never checks.
  await page.reload();
  await expect(page.getByLabel("Message Scout")).toBeVisible();
  await expect(
    page.getByRole("link", { name: `Interest: ${TOPIC}` }),
  ).toBeHidden({ timeout: 30_000 });
});
