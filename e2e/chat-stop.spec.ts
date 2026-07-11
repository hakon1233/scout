import { expect, test, type Page } from "@playwright/test";

// Chat Stop / abort mid-turn (PER-228 chunk 3, fixed in PER-232), driven
// end-to-end against the REAL companion /v0/chat + /v0/chat/stop routes. This is
// the no-dead-control contract's hardest case: the companion is kick→poll, so
// aborting only the client poll is NOT enough — the server-side model edit would
// still complete and persist ~14s later (the original AC3/AC5 regression). A
// correct Stop must abort the SERVER turn: kill the child, land the turn
// `failed` with NO changes applied.
//
// We make the turn deterministically abortable with a stub stall: the message
// carries the `__STALL_FOR_STOP__` sentinel, so e2e/fixtures/stub-claude.mjs
// holds its (create) response for SCOUT_STUB_STALL_MS (default 4s) instead of
// answering instantly. That gives a real in-flight window to press Stop. The op
// is a plain create, so absent an abort the interest WOULD land — which is what
// makes the "still absent after a server reload, past the stall" assertion a
// genuine proof that the server turn (not just the poll) was cancelled.
//
// Fully offline and deterministic: no network, no Anthropic/Exa key, no quota.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;
// A topic that cannot pre-exist in the seeded rail, so its presence/absence is
// an unambiguous signal that the create did/did not persist.
const TOPIC = "Ephemeral stop-test topic";
const STALL_MARKER = "__STALL_FOR_STOP__";

async function interestLinkCount(page: Page): Promise<number> {
  return page.getByRole("link", { name: `Interest: ${TOPIC}` }).count();
}

test("chat Stop aborts the in-flight turn server-side: no change persists", async ({
  page,
}) => {
  // This turn is deliberately held by the stub (4s) and then we wait past the
  // stall and reload to prove no late server-side persist — comfortably more
  // wall-clock than the 30s default.
  test.setTimeout(60_000);
  await page.goto(`${ORIGIN}/app/interests/`);
  await expect(page.getByLabel("Message Scout")).toBeVisible();

  // Baseline: the topic is not in the rail and no applied card exists yet.
  expect(await interestLinkCount(page)).toBe(0);

  // ── Kick a create turn that the stub will HOLD, then Stop it mid-flight ─────
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const composer = page.getByLabel("Message Scout");
  await composer.click();
  await composer.fill(`Create an interest about ${TOPIC} ${STALL_MARKER}`);
  // Gate the submit on the Send button enabling. It is `disabled` until the
  // trimmed draft is non-empty, which only flips once React has processed the
  // fill's onChange — so this is a state-independent hydration signal (the bare
  // composer can be visible a beat before React wires the form's handlers, and
  // the empty-state chips aren't reliable across a shared-companion run). Once
  // enabled, the onSubmit/onClick handlers are attached and the click will land.
  const sendBtn = page.getByRole("button", { name: "Send" });
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();

  // Sending begins immediately: the composer swaps Send → Stop. This is the
  // affordance the contract promises while a turn is in flight.
  const stopBtn = page.getByRole("button", { name: "Stop" });
  await expect(stopBtn).toBeVisible();
  // The user's message is in the log, but the turn is still pending — no applied
  // card for THIS topic has resolved (the stub is holding its answer). Scope the
  // assertion to our unique topic: the companion's chat transcript and interest
  // rail persist across specs, so a generic "Undo"/"Created" count is polluted
  // by earlier specs — our ephemeral topic is the unambiguous signal.
  await expect(page.getByText(`Created · ${TOPIC}`)).toHaveCount(0);

  // Let the server-side kick register the turn id (so Stop aborts via the
  // concrete turn id path, the common case), then press Stop — well within the
  // stub's stall window.
  await page.waitForTimeout(1000);
  await stopBtn.click();

  // Stop resolves the in-flight state: the composer returns to Send (sending is
  // false) and Stop is gone. A user Stop is not an error, so no error bubble.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);

  // No change was applied client-side: no "Applied" card for our topic surfaced
  // and the interest never entered the rail.
  await expect(page.getByText(`Created · ${TOPIC}`)).toHaveCount(0);
  expect(await interestLinkCount(page)).toBe(0);

  // ── The PER-232 proof: wait PAST the stall, then reload from the server ────
  // If Stop only cancelled the client poll (the old bug), the held child would
  // have flushed its create after the stall and the companion would have
  // persisted it — a server reload would then surface the interest. We wait
  // comfortably past the 4s default stall, then reload so the rail is re-fetched
  // from the companion (interests are server-backed, not local-only).
  await page.waitForTimeout(6000);
  await page.reload();
  await expect(page.getByLabel("Message Scout")).toBeVisible();
  // The interest never persisted: the server-side turn was genuinely aborted.
  expect(await interestLinkCount(page)).toBe(0);
});
