import { expect, test, type Page } from "@playwright/test";
import { PORT } from "./port";

// Every other confirm-gated (delete/rewrite) spec has only ONE interest alive
// at a time, so they all incidentally target "the first (and only) id in the
// snapshot" — never proving the FE correctly threads a SPECIFIC, non-first
// interestId through the confirm flow. stub-claude.mjs resolves a
// delete/rewrite's target by matching the topic the user actually NAMED
// against the snapshot, instead of always answering with snapshots[0] —
// mirroring how a real model reads the topic list. That is what makes both
// specs below possible; generic phrasing ("delete that interest for good", no
// topic named) still falls back to the first snapshot.
//
// Fully offline and deterministic: no network, no Claude account, no quota.

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
  await expect(page.getByText(`Confirm delete · ${FIRST}`)).toHaveCount(0);

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

test("a single turn naming two deletions offers one card for both, and one Delete removes both", async ({
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

  await sendMessage(page, `Please delete ${A} and ${B}`);

  const confirm = page
    .getByRole("alertdialog")
    .filter({ hasText: `Confirm delete · ${A}, ${B}` });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  // Nothing is removed until the reader confirms.
  await expect(railA).toBeVisible();
  await expect(railB).toBeVisible();

  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm.getByText("Removed from your interests")).toBeVisible({
    timeout: 30_000,
  });
  await expect(railA).toBeHidden({ timeout: 30_000 });
  await expect(railB).toBeHidden({ timeout: 30_000 });
});
