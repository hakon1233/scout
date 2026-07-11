import { expect, test, type Page } from "@playwright/test";

// The chat Retry affordance after a genuinely FAILED turn (AIR-528, gap flagged
// after AIR-462), driven end-to-end against the REAL companion /v0/chat route —
// not a FE `?mock=` seed. The stub `claude` (e2e/fixtures/stub-claude.mjs) exits
// nonzero on the `__FAIL_CHAT_TURN__` sentinel, the same shape a real model/CLI
// crash produces, so the companion lands the turn `status: "failed"` with a real
// `error_msg` (packages/agent/src/chat.ts:808) — no mocking of the FE's own
// error handling.
//
// The per-message "Retry" button (ChatDock.tsx) only exists on `scout`-role
// messages, and useProfileWorkbench.dispatch's catch block (a LIVE failure)
// never appends one — it only sets a top-level banner string and clears the
// composer draft. So immediately after a live failure, the ONLY reachable
// Retry buttons belong to unrelated EARLIER scout replies — and retry()
// truncates the transcript to `slice(0, idx)` before re-dispatching, which
// drops every message AFTER the one you pressed Retry on. Concretely: press
// the create's Retry while a later turn has failed, and the failed "you"
// bubble plus its error state are silently erased along with it, while an
// unrelated turn re-runs in their place.
//
// That re-run is worse than a relabeled re-send: retry() never reverses the
// ORIGINAL create it's retrying — it only drops that turn's chat CARD from the
// local message list, then dispatches a brand-new "create" turn. The original
// interest is still live server-side, so the result is a genuine, silent
// SERVER-SIDE DUPLICATE — two interests, two ids, the same topic — and the chat
// log only ever shows one "Created" card, because the older one was truncated
// out of view. The interest rail is the only place the duplication is visible.
//
// Only a full page reload rehydrates the failed turn from the transcript
// (`failed: true`) and gives it its own, correctly-targeted Retry. This spec
// proves all three: the wrong-turn re-send, the hidden duplicate it leaves
// behind, and the reload-only path to a correctly-targeted retry.
//
// Fully offline and deterministic: no network, no Anthropic/Exa key, no quota.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
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

test("a failed chat turn has no live retry: the only reachable Retry re-runs the WRONG turn; only a reload targets the right one", async ({
  page,
}) => {
  test.skip(
    !!process.env.CI,
    "AIR-642: stub-claude.mjs crashes deterministically in CI (ReferenceError: stdin is not defined) — test-infra bug, passes locally, tracked for root-cause",
  );
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  // ── Baseline: one real, successful turn (create) ──────────────────────────
  await sendMessage(page, `Create an interest about ${TOPIC}`);
  await expect(page.getByText(`Created · ${TOPIC}`)).toBeVisible({
    timeout: 30_000,
  });

  // ── The turn that FAILS server-side ────────────────────────────────────────
  await sendMessage(page, `Anything new to report? ${FAIL_MARKER}`);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  // Scoped to the app's own error `<p role="alert">` — Next.js's route
  // announcer (`#__next-route-announcer__`) also carries role="alert" and would
  // otherwise make this locator ambiguous.
  const banner = page.locator('p[role="alert"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("claude exited 1");

  // The failure did NOT append a scout reply: the founder's "you" bubble is the
  // LAST thing in the transcript, full stop — proven structurally (the last
  // direct child of the log is our failed bubble), not by counting Retry
  // buttons. A global count is the wrong tool here: the chat transcript is
  // shared across the whole suite (single companion instance, no per-spec
  // reset) and keeps growing every run, so a global Retry-button count is both
  // polluted by earlier specs AND racy against the transcript's own async
  // hydration on page load. Since retry() only ever targets scout messages,
  // "nothing follows the failed bubble" is sufficient proof no control
  // anywhere can target THIS turn.
  const failedYouBubble = page.getByText(
    `Anything new to report? ${FAIL_MARKER}`,
  );
  await expect(failedYouBubble).toBeVisible();
  const transcriptEntries = page.locator(
    '[role="log"][aria-label="Conversation with Scout"] > div > *',
  );
  await expect(transcriptEntries.last()).toContainText(FAIL_MARKER);

  // ── Press the ONLY Retry available — it targets the earlier create, not the
  // failure ───────────────────────────────────────────────────────────────────
  const createReply = page
    .locator(".group\\/msg", { hasText: `Created · ${TOPIC}` })
    .first();
  await createReply.getByRole("button", { name: "Retry" }).click();

  // Proof it fired the WRONG turn AND destroyed the failed one: retry()
  // truncates messages to `slice(0, idx)` before re-dispatching, so pressing
  // Retry on the create doesn't just re-run it — it deletes every message
  // after it, including the founder's failed attempt and its error banner.
  // The failed bubble is now gone entirely, with no trace it ever happened —
  // and the chat log shows exactly one "Created · TOPIC" card again, which
  // LOOKS like a clean replace.
  await expect(page.getByText(`Created · ${TOPIC}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`Created · ${TOPIC}`)).toHaveCount(1);
  await expect(failedYouBubble).toHaveCount(0);
  await expect(banner).toHaveCount(0);

  // It is NOT a clean replace: retry() never reversed the original create, it
  // only dropped that turn's CARD from the local message list before
  // dispatching a fresh one. The original interest is still live server-side,
  // so the interest rail — unlike the chat log — shows the truth: two separate
  // cards for the same topic, two different ids underneath.
  const railLinks = page.getByRole("link", { name: `Interest: ${TOPIC}` });
  await expect(railLinks).toHaveCount(2);

  // ── Only a reload surfaces the failed turn itself, with its OWN Retry ──────
  await page.reload();
  await expect(page.getByLabel("Message Scout")).toBeVisible();
  await expect(
    page.getByText(/I couldn't finish that turn:/),
  ).toBeVisible({ timeout: 30_000 });

  const failedReply = page
    .locator(".group\\/msg", { hasText: "I couldn't finish that turn:" })
    .first();
  const failedRetry = failedReply.getByRole("button", { name: "Retry" });
  await expect(failedRetry).toBeVisible();

  // This Retry DOES target the right turn (the sentinel-carrying wire text is
  // preserved verbatim) — pressing it re-dispatches the same doomed message and
  // fails again identically, proving retry() is correctly wired post-reload;
  // the only gap is that a founder needs the reload to reach it at all.
  await failedRetry.click();
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText("claude exited 1");

  // ── Cleanup: remove BOTH interests this spec created ────────────────────────
  // The chat transcript is shared across every spec in the suite (single
  // companion instance), and other specs' assertions are not always scoped to
  // their own topic — leaving permanent "Applied"+Undo cards around is a real
  // source of cross-spec ambiguity. There are two duplicate interests to remove
  // (the wrong-turn retry's silent duplicate, proven above), and each "Delete
  // that interest" only ever targets one — so repeat until the rail is clear.
  let remaining = await railLinks.count();
  while (remaining > 0) {
    await sendMessage(page, "Delete that interest");
    const confirm = page.getByRole("alertdialog").last();
    await expect(confirm.getByText(`Confirm delete · ${TOPIC}`)).toBeVisible({
      timeout: 30_000,
    });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(
      confirm.getByText("Removed from your interests"),
    ).toBeVisible({ timeout: 30_000 });
    remaining -= 1;
    await expect(railLinks).toHaveCount(remaining, { timeout: 30_000 });
  }
});
