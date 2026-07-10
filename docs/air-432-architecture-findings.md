# AIR-432 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-06-27._

## TL;DR

The `@scout/agent` companion ↔ Next.js web split remains structurally sound.
This is the 13th+ architecture pass; the tree was at the AIR-417 fix commit
(`06b7a38`) at the start of this pass, so the standing structural debt is already
comprehensively tracked by a well-shaped open backlog.

A scoped, backlog-filtered re-scan surfaced **one genuinely net-new,
clearly-safe, reversible fix**, which was **landed in-pass**: the two
confirm-gated chat paths (`confirmDeleteTurn` / `confirmRewriteTurn`) awaited
their `appendChatTranscript` tail and let it throw to the HTTP route — turning an
*already-committed* delete/rewrite into a 500. No new issues filed — every other
candidate maps to an already-open issue or a deliberate prior tradeoff.

**Tree left green: `tsc --noEmit` clean, `pnpm test` 142/142 (hermetic/offline),
added lines prettier-clean.**

## Fixed in this pass (small, clearly-safe, reversible)

### F1 — confirm-turn transcript tail could 500 an already-committed change ✅ FIXED

- **Files:** `packages/agent/src/chat.ts` — `confirmDeleteTurn` (~L773) and
  `confirmRewriteTurn` (~L839).
- **Problem:** Both confirm-gated, no-model paths do their durable work first —
  `saveState(...)` commits the removed/updated interest set **and** the `ready`
  turn into `state.last_chat` — and only then call
  `await appendChatTranscript(turn, ...)`. The transcript append was awaited
  bare. If `appendChatTranscript` throws (ENOSPC, EACCES, a transient FS blip),
  the exception escapes the `try`, `finally` resets `chatInFlight`, and the throw
  propagates to the `/v0` route as a **500 — for an operation that already
  succeeded and persisted.** Worse, the client's natural retry then **404s**:
  the `pending_delete` / `pending_rewrite` proposal was consumed by the first
  (successful) call, so `confirm*Turn` returns `not_found`. Net user experience:
  "my delete/rewrite errored," but it actually committed — and there's no stderr
  signal either.
- **Why net-new (not a re-file):** This is distinct from the tracked items.
  `runChatTurn`'s transcript tail (L925) is **already** crash-/observability-safe
  because it is dispatched fire-and-forget — `startChatTurn` wraps it in
  `void runChatTurn(...).catch((err) => console.error(...))` (the AIR-388 /
  PER-pattern guard). The two **awaited** confirm paths were the remaining
  asymmetry: same "transcript is a secondary record after the durable write"
  shape, but without the best-effort guard. Not AIR-177 (that's the `String(err)`
  *body* leak on the `/v0` 500 path), not AIR-196 (corrupt-read wipe), not
  AIR-178 (transcript growth cap).
- **Fix:** Make the two confirm-turn transcript appends best-effort + logged:
  `await appendChatTranscript(...).catch((err) => console.error("[chat] confirm-… transcript append failed:", err))`.
  Control flow is otherwise unchanged — the delete/rewrite is already durable in
  `state.last_chat`, so a logged transcript miss degrades to "one history line
  didn't land" instead of "successful op reported as a 500 the client can't
  retry." Purely additive crash-safety + observability, matching the existing
  `runChatTurn` / `startChatTurn` / `scheduler.ts` `void …().catch()` pattern.
- **Verification:** `tsc --noEmit` clean; `pnpm test` 142/142; the two added
  blocks are prettier-conformant (verified `--write` leaves them untouched).

## Considered, not changed

- **`applyChatChanges` mid-loop `writeInterestDoc` throw (chat.ts:532/547).**
  A scan candidate flagged this as "state corruption," but it is not: if a
  per-change `writeInterestDoc` throws, the throw propagates **before**
  `applyChatChanges` returns, so the partial `interests` array is never returned
  or persisted. `runChatTurn`'s outer `try/catch` (L899) lands a `failed` turn
  and persists `fresh.interests` **unchanged**. The only residue is an orphaned
  `<id>.md` doc on disk (harmless, unreferenced). The current fail-fast is
  **correct** (don't half-commit to `state.interests`); swallowing per-change
  errors would be a behavior change with no clear win. Left as-is.
- **Pre-existing prettier drift in `chat.ts`** (`buildChatPrompt` quote style,
  `preserveCorruptTranscript` wrap). The committed file already fails
  `prettier --check` (CI does not gate prettier on agent `src`). Deliberately
  **not** swept up here — bundling a whole-file reformat into a one-finding
  architecture pass would bury a 4-line behavior change in unrelated churn. If
  desired, a standalone `format:` commit is the right home.

## Already tracked — confirmed open, NOT re-filed

| Issue | Item |
|---|---|
| AIR-197 | Extract route table + `withAuthedJson` from the 1,119-line `server.ts` |
| AIR-198 | Shared `spawnClaude()` + chat per-session timeout |
| AIR-195 | Chat confirm-delete/rewrite TOCTOU vs. in-flight turn |
| AIR-196 | `readChatTranscript` corrupt-read handling |
| AIR-177 | `/v0` 500 handler leaks `String(err)` to client (`server.ts:1102`) |
| AIR-178 | Cap chat transcript growth (last-N) |
| AIR-374 | `POST /v0/weekly-brief` bypasses single-flight, clobbers brief slot |
| AIR-375 | Decompose `AppPage` god-component |
| AIR-376 | Extract + unit-test brief-markdown parser out of `companion.ts` |
| AIR-272 | Pin web↔agent wire contract via contract test (type-shape dup) |
| AIR-356 N1/N2 | Scattered client fetch timeouts; structured logging / correlation IDs |

## Verification

- No paid Apify scrape was run (no Apify integration exists in the repo; scraping
  is delegated to the `claude` CLI's WebSearch/WebFetch — the hard-guardrail flow
  is not reachable here).
- No secrets were read or exfiltrated; the new error logs carry only the caught
  error, never the OAuth token (spawn never forwards it — PER-108 guard).
- Open backlog checked via the Paperclip issue API before deciding not to file
  duplicates.
- `pnpm test` 142/142, `tsc --noEmit` clean; added lines prettier-clean.

## Method

CAM tools (`read_inheritance_context`) were not registered this run;
reconstructed prior context from `docs/air-417-architecture-findings.md`,
`docs/air-402-architecture-findings.md`, and the live open-issue backlog. Sized
every module (`wc -l`), confirmed the tree was unchanged since AIR-417, grepped
for fresh smells (bare `catch {}`, `String(err)` leaks, `TODO/FIXME`, timeout
constants — all clean or already tracked), fanned out one read-only review agent
over the fat modules filtered against the tracked backlog, hand-verified the one
net-new finding (and rejected the over-stated "corruption" candidate), applied
the clearly-safe additive guard, scoped the diff to exactly the change (reverting
an incidental whole-file prettier reformat), and re-ran the full green bar.
