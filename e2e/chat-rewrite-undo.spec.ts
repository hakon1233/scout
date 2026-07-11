import { expect, test, type Page } from "@playwright/test";

// Does a CONFIRMED rewrite get the same live Undo affordance a create does
// (PER-139 no-dead-control)? chat-actions.spec proves the [Apply]/[Discard]
// proposal card is a real control (Apply hits the deterministic confirm-rewrite
// route and the card locks to "Applied"). chat-undo.spec proves the CREATE op's
// Undo is live. Neither ever checks whether pressing Apply on a rewrite leaves
// the founder with any way to reverse it — this spec presses that gap.
//
// Root cause read from source (src/components/profile/useProfileWorkbench.ts):
// `dispatch()` (the live-turn path) attaches BOTH `changes` and a `prev` doc
// snapshot to the new scout message, which is what lets ChatDock render a
// `ChatActionCard` with a real Undo button (ChatActionCard.tsx). `confirmRewrite()`
// receives the exact same shape back from the server (confirmRewriteTurn emits
// `changes: [{op:"update", ...}]`, packages/agent/src/chat.ts ~line 731) but only
// feeds it through `applyChanges()` to update the rail — it never attaches
// `changes`/`prev` to a message, so no `ChatActionCard` — and therefore no Undo —
// ever renders for a rewrite. The founder is left with zero in-app way to revert
// an applied rewrite; the only recourse is typing a manual "revert to exactly
// this text" message and hoping the model complies.
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

test("chat rewrite Apply leaves NO Undo affordance, unlike create", async ({
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

  // ── THE GAP — the rewrite landed, but no new Undo control ever appeared ───
  // The rewrite card itself carries no Undo button — the resolved-rewrite
  // template (ChatRewriteProposal, resolved==="applied") has none.
  await expect(
    rewriteReply.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);

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
