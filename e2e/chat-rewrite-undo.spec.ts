import { expect, test, type Page } from "@playwright/test";

// Does a CONFIRMED rewrite get the same live Undo affordance a create does
// (PER-139 no-dead-control)? chat-actions.spec proves the [Apply]/[Discard]
// proposal card is a real control (Apply hits the deterministic confirm-rewrite
// route and the card locks to "Applied"). chat-undo.spec proves the CREATE op's
// Undo is live. This spec presses the gap they leave: after pressing Apply, can
// the founder still reverse the rewrite in-app?
//
// AIR-611 fix (src/components/profile/useProfileWorkbench.ts): `dispatch()` (the
// live-turn path) attaches BOTH `changes` and a `prev` doc snapshot to the new
// scout message, which is what lets ChatDock render a `ChatActionCard` with a real
// Undo button (ChatActionCard.tsx). `confirmRewrite()` receives the exact same
// shape back from the server (confirmRewriteTurn emits `changes: [{op:"update",
// ...}]`, packages/agent/src/chat.ts) and now, via `appliedChangeMessage()`,
// appends it as its own action card — so a confirmed rewrite renders the same live
// Undo a create does. Before the fix it only fed the change through
// `applyChanges()` to update the rail and dropped the `changes`/`prev` on the
// floor, so no Undo ever appeared until a page reload re-projected the same
// confirm turn through transcriptMessages().
//
// Fully offline and deterministic: no network, no Anthropic/Exa key, no quota.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOPIC = "Fusion reactor permitting";

async function sendMessage(page: Page, text: string) {
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const composer = page.getByLabel("Message Scout");
  await composer.click();
  await composer.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("chat rewrite Apply surfaces a live Undo, same as create (AIR-611)", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  // ── CREATE — baseline: this op DOES get a live Undo ───────────────────────
  await sendMessage(page, `Create an interest about ${TOPIC}`);
  const createReply = page
    .locator(".group\\/msg", { hasText: `Created · ${TOPIC}` })
    .first();
  await expect(
    createReply.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const railLink = page.getByRole("link", { name: `Interest: ${TOPIC}` });
  await expect(railLink).toBeVisible();

  // ── REWRITE — propose, then Apply via the real confirm-rewrite route ──────
  // Scoped to THIS spec's own rewrite turn by its stable header text, which
  // survives the card resolving (unlike an `alertdialog` role locator — the
  // role is dropped once resolved, see ChatActionCard.tsx's
  // `role={resolved ? undefined : "alertdialog"}` — so re-querying an
  // `alertdialog` locator AFTER Apply would match nothing and make any
  // "no Undo" assertion on it vacuously true). The transcript is shared across
  // the whole suite (single companion instance, no per-spec reset, see
  // chat-undo.spec's own note), so this also avoids tripping over Undo buttons
  // other specs left behind in earlier turns.
  await sendMessage(page, "Completely rewrite that interest from scratch");
  const rewriteReply = page
    .locator(".group\\/msg", { hasText: `Proposed rewrite · ${TOPIC}` })
    .first();
  await expect(rewriteReply.getByText(`Proposed rewrite · ${TOPIC}`)).toBeVisible({
    timeout: 30_000,
  });
  await rewriteReply.getByRole("button", { name: "Apply" }).click();
  await expect(rewriteReply.getByText("Rewrite written to the doc")).toBeVisible({
    timeout: 30_000,
  });
  // The card resolved — no more Apply/Discard.
  await expect(rewriteReply.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await expect(rewriteReply.getByRole("button", { name: "Discard" })).toHaveCount(0);

  // ── THE FIX (AIR-611) — Apply now surfaces the same live Undo a create gets ─
  // The proposal card itself still just locks to "Applied" — it is the confirm
  // gate, not the reversal affordance — so it carries no Undo of its own.
  await expect(
    rewriteReply.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);
  // ...but confirmRewrite() now appends the applied update as its own scout
  // action card (the exact shape dispatch() gives a live turn and a reload gives
  // a hydrated one), so a real Undo button renders for the confirmed rewrite —
  // the same ChatActionCard + undo channel chat-undo.spec proves is live for a
  // create. Before AIR-611 the turn's `changes` were dropped on the floor and no
  // Undo ever appeared without a page reload.
  const appliedCard = page
    .locator(".group\\/msg", { hasText: `Updated · ${TOPIC}` })
    .first();
  await expect(appliedCard.getByText(`Updated · ${TOPIC}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    appliedCard.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();

  // ── CONFIRM THE DATA ACTUALLY CHANGED (this is not a no-op UI gap) ────────
  // Open the interest's own doc scope page and check the body now reflects the
  // rewrite, not the original create doc — the change is real and durable, it
  // is just unreachable through any chat Undo.
  await railLink.click();
  // Scoped to the doc-body container: the chat transcript above still shows
  // the SAME text (as its diff/reply), so an unscoped locator would be
  // ambiguous — this is about the durable doc, not the chat log.
  const docBody = page.locator(".scout-md");
  await expect(docBody.getByRole("heading", { name: "Rewritten intent" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(docBody.getByText("Fresh angle one")).toBeVisible();
  // The original create doc's body text is gone — the rewrite is genuinely
  // durable, no trace of "Surface concrete developments" remains.
  await expect(docBody.getByText("Surface concrete developments")).toHaveCount(0);

  // ── Cleanup: remove the interest this spec created ────────────────────────
  // The interest store is shared across the whole suite (single companion
  // instance, no per-spec reset — see chat-retry.spec's own note). The stub
  // targets confirm-gated ops by the FIRST id in the snapshot, so an
  // un-deleted leftover here would silently hijack targeting in every spec
  // that runs after this one (confirmed: leaving this out made
  // chat-undo.spec's confirm-delete card target the wrong topic). The chat
  // column stays mounted even inside the drilled-in doc view (PER-236 fix 2),
  // so no navigation is needed to reach the composer.
  await sendMessage(page, "Delete that interest for good");
  const confirmDelete = page.getByRole("alertdialog").last();
  await expect(confirmDelete.getByText(`Confirm delete · ${TOPIC}`)).toBeVisible({
    timeout: 30_000,
  });
  await confirmDelete.getByRole("button", { name: "Delete" }).click();
  await expect(
    confirmDelete.getByText("Removed from your interests"),
  ).toBeVisible({ timeout: 30_000 });
});
