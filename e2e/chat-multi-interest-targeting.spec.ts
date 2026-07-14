import { expect, test, type Page } from "@playwright/test";

// AIR-691: every prior confirm-gated (delete/rewrite) spec has only ever had
// ONE interest alive at a time, so they all incidentally target "the first
// (and only) id in the snapshot" — never proving the FE correctly threads a
// SPECIFIC, non-first interestId through the confirm flow. Flagged as an open
// gap by three prior /qa-live passes (AIR-528, AIR-604, AIR-667) and never
// picked up. stub-claude.mjs (this pass) now resolves a delete/rewrite's
// target by matching the topic the user actually NAMED against the snapshot,
// instead of always answering with snapshots[0] — mirroring how a real model
// reads the topic list. That upgrade is what makes both specs below possible;
// every pre-existing spec's generic phrasing ("delete that interest for
// good", no topic named) still falls back to the first snapshot exactly as
// before, so nothing else in the suite changes behavior.
//
// Fully offline and deterministic: no network, no Anthropic/Exa key, no quota.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function sendMessage(page: Page, text: string) {
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const composer = page.getByLabel("Message Scout");
  await composer.click();
  await composer.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function deleteInterestByTopic(page: Page, topic: string) {
  await sendMessage(page, `Delete ${topic}`);
  const confirm = page
    .getByRole("alertdialog")
    .filter({ hasText: `Confirm delete · ${topic}` });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm.getByText("Removed from your interests")).toBeVisible({
    timeout: 30_000,
  });
}

test("chat delete targets the SPECIFIC interest named, not always the first in the snapshot", async ({
  page,
}) => {
  const FIRST = "Robotics manufacturing";
  const SECOND = "Interest rate policy";
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  // Create two interests — FIRST lands in the snapshot before SECOND.
  await sendMessage(page, `Create an interest about ${FIRST}`);
  await expect(
    page.locator(".group\\/msg", { hasText: `Created · ${FIRST}` }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await sendMessage(page, `Create an interest about ${SECOND}`);
  await expect(
    page.locator(".group\\/msg", { hasText: `Created · ${SECOND}` }).first(),
  ).toBeVisible({ timeout: 30_000 });

  const firstRail = page.getByRole("link", { name: `Interest: ${FIRST}` });
  const secondRail = page.getByRole("link", { name: `Interest: ${SECOND}` });
  await expect(firstRail).toBeVisible();
  await expect(secondRail).toBeVisible();

  // ── Ask to delete the NON-first (second-created) interest by name ────────
  await sendMessage(page, `Please delete ${SECOND}`);
  const confirmSecond = page
    .getByRole("alertdialog")
    .filter({ hasText: `Confirm delete · ${SECOND}` });
  await expect(confirmSecond).toBeVisible({ timeout: 30_000 });
  // The card names the interest the user actually asked for, not the first
  // one created — if targeting regressed to "always first", this card would
  // read "Confirm delete · Robotics manufacturing" instead.
  await expect(
    page.getByText(`Confirm delete · ${FIRST}`),
  ).toHaveCount(0);

  await confirmSecond.getByRole("button", { name: "Delete" }).click();
  await expect(
    confirmSecond.getByText("Removed from your interests"),
  ).toBeVisible({ timeout: 30_000 });

  // The NAMED interest is gone; the untouched one survives.
  await expect(secondRail).toBeHidden({ timeout: 30_000 });
  await expect(firstRail).toBeVisible();

  // ── Cleanup: remove the remaining interest (net-zero for later specs) ────
  // The interest store is shared across the whole suite (single companion
  // instance, no per-spec reset) — an un-deleted leftover here would hijack
  // topic-matching for any later spec's generic "delete that interest for
  // good" phrasing (which falls back to snapshots[0]).
  await deleteInterestByTopic(page, FIRST);
  await expect(firstRail).toBeHidden({ timeout: 30_000 });
});

test("a single turn naming two deletions only ever surfaces one confirm card — the other silently never happens (AIR-691)", async ({
  page,
}) => {
  const A = "Quantum computing";
  const B = "Renewable energy";
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  await sendMessage(page, `Create an interest about ${A}`);
  await expect(
    page.locator(".group\\/msg", { hasText: `Created · ${A}` }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await sendMessage(page, `Create an interest about ${B}`);
  await expect(
    page.locator(".group\\/msg", { hasText: `Created · ${B}` }).first(),
  ).toBeVisible({ timeout: 30_000 });

  const railA = page.getByRole("link", { name: `Interest: ${A}` });
  const railB = page.getByRole("link", { name: `Interest: ${B}` });
  await expect(railA).toBeVisible();
  await expect(railB).toBeVisible();

  // ── ONE message asking to delete BOTH ─────────────────────────────────────
  // The stub (mirroring a real model, given the same instructions) proposes
  // TWO delete changes in this turn's `changes` array — a perfectly ordinary
  // compound request. chat.ts's applyChatChanges collects both into
  // `pendingDeletes` (confirmed via source read: packages/agent/src/chat.ts),
  // but runChatTurn only ever puts `pendingDeletes[0]` on the turn object it
  // hands to the FE — the second proposal has no code path that ever reaches
  // the client. This is the real bug this spec proves, not a stub artifact.
  await sendMessage(page, `Please delete ${A} and ${B}`);

  // The assistant's own reply (streamed into the transcript) claims BOTH are
  // pending — this is the text a founder actually reads.
  await expect(
    page.getByText(`Delete ${A} and ${B}?`, { exact: false }),
  ).toBeVisible({ timeout: 30_000 });

  // ...but only ONE confirm card ever renders, for whichever topic happened
  // to be first in the snapshot (A, created first). No card for B exists
  // anywhere in the transcript — not pending, not resolved, never created.
  // (ChatDeleteConfirm's `role="alertdialog"` is unconditional — it is never
  // dropped once a card resolves, unlike ChatActionCard's rewrite proposal —
  // so every delete-confirm card the whole session ever rendered stays
  // queryable by that role; asserting on B's own topic text, rather than a
  // global alertdialog count, is what actually isolates THIS turn's claim.)
  const confirmA = page
    .getByRole("alertdialog")
    .filter({ hasText: `Confirm delete · ${A}` });
  await expect(confirmA).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Confirm delete · ${B}`)).toHaveCount(0);

  // Confirm the one card that exists.
  await confirmA.getByRole("button", { name: "Delete" }).click();
  await expect(confirmA.getByText("Removed from your interests")).toBeVisible({
    timeout: 30_000,
  });
  await expect(railA).toBeHidden({ timeout: 30_000 });

  // The SECOND requested deletion never happened — no card, no error, no
  // trace anywhere in the transcript. The interest the founder explicitly
  // asked to remove in the same breath as A is still fully alive.
  await expect(railB).toBeVisible();

  // ── Cleanup: remove B on its own (now the only interest, so the fallback
  // "no topic named → first snapshot" path also resolves it correctly) ─────
  await deleteInterestByTopic(page, B);
  await expect(railB).toBeHidden({ timeout: 30_000 });
});
