# Bug hunt & fix pass — 2026-07-12 (AIR-425)

Recurring Quality-Loop pass (Engineer slice of AIR-425). Scope: real,
user-visible behavior bugs with small, reversible fixes. Security, performance,
design, docs, architecture, and product-gap work belong to sibling lanes.

Hard guardrail honored: no paid Apify scrape or external paid API was run. This
pass used local code reading and local tests only.

## Fixed

1. **Confirm-gated delete/rewrite Stop was a dead control and could clobber a
   later turn's sending state** (high) — FIXED.
   `src/components/profile/useProfileWorkbench.ts` showed the same Stop UI while
   a confirm-delete or confirm-rewrite request was in flight, but those requests
   did not use the hook's abort controller. Pressing Stop only flipped local UI
   state; the request could still complete and apply the destructive change.
   Both confirm handlers also cleared `sending` unconditionally in `finally`, so
   a stopped confirm resolving after a newer send could flip the composer back to
   Send mid-turn. Fix: `confirmDeleteInterest()` and `confirmRewriteInterest()`
   now accept a caller `AbortSignal`; both hook confirm handlers start a scoped
   abort controller, suppress abort rejections, clear only that controller, and
   only clear `sending` when their own controller was not aborted. This mirrors
   the existing `dispatch()` guard added for AIR-107.

## Regression Guard

- Added `src/lib/chat.test.ts` covering caller abort-signal propagation for both
  confirm routes.
- Wired that test into `pnpm run test:web`.

## Verification

- `pnpm exec tsx --test src/lib/chat.test.ts` — pass, 2/2.
- `pnpm run test:web` — pass, 51/51.
- `pnpm exec eslint src/lib/chat.ts src/lib/chat.test.ts src/components/profile/useProfileWorkbench.ts` — pass.
- `pnpm run typecheck` — blocked by an unrelated concurrent workspace edit:
  `packages/agent/test/loopback.test.ts(475,11): error TS2304: Cannot find name
  'doneP'.` That file was already dirty and is outside this pass's patch.

## Notes

The existing AIR-651 backlog issue describes the bug fixed here. No new
follow-up issue was opened because the fix is included in this pass.
