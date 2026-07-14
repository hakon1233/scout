# Bug hunt & fix pass - 2026-07-14 (AIR-663)

Recurring Quality-Loop pass, Engineer slice. Scope: find a real correctness
edge, reproduce it locally, and land the smallest reversible fix with a durable
regression guard. Security, design, docs, performance, product gaps, and
architecture are covered by sibling lanes in this same pass.

## Fixed

1. **`GET /v0/briefs?limit=&offset=` returned only one history item.**
   The paginated brief-history route treated `URLSearchParams.get("limit") ===
   ""` as numeric zero because `Number("") === 0`. The clamp then returned `0`,
   and the route's `Math.max(1, ...)` converted that into a limit of 1 instead
   of the documented default page size of 3. This only affected malformed or
   hand-written URLs with blank query values; the normal client sends concrete
   `limit=3&offset=N`, and the no-query legacy poller path was unchanged.

## Change

- Updated `packages/agent/src/routes/briefs.ts` so blank query values are
  treated like omitted values before numeric coercion.
- Extended `packages/agent/test/contract.test.ts`'s PER-219 pagination test to
  assert `?limit=&offset=` returns the default three newest history entries,
  not a first-item-only page.

## Verification

- Baseline before editing: `pnpm test` passed (root 2, agent 161, web 58).
- Red reproducer: `pnpm --filter @scout/agent exec tsx --test test/contract.test.ts`
  failed as expected with `empty limit uses the default page size`, actual `1`
  vs expected `3`.
- Focused green: same contract-test command passed after the fix, 12/12.
- Full required `/v0` verification: `pnpm test` passed after the fix (root 2,
  agent 161, web 58).

## Notes

- No new follow-up issue was opened. The bug is low-severity and fully fixed by
  the local parser guard plus contract coverage.
- I left unrelated untracked work alone:
  `docs/audits/2026-07-14-docs-onboarding-freshness-pass-AIR-660.md`.
