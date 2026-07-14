# Bug hunt & fix pass - 2026-07-14 (AIR-678)

Recurring Quality-Loop pass. Scope: find a real red/fragile path, localize the
root cause, and land the smallest fix with fresh verification.

## Fixed

1. **`liked-live-flow` was a false red after the Liked feed a11y fix.**
   `e2e/liked-live-flow.spec.ts` still asserted the generated story heading as
   level 3. The product markup was intentionally changed in commit `6d95918`
   (`fix(a11y): CAR-179 fix heading-order skip on Liked feed`) so Liked feed
   cards use `h2` under the page `h1`. The Playwright error context confirmed
   the story was present in the Liked feed as heading level 2; only the test's
   role query was stale.

## Change

- Updated the live like/write-read e2e to assert `Alignment update` at heading
  level 2, preserving the accessibility contract introduced by `6d95918`.
- Removed the stale CI skip that referenced the old AIR-642 stub-claude crash.
  The focused spec now runs under `CI=1` and exercises the full generated-brief
  like flow instead of being skipped.

## Verification

- `pnpm test` - pass before the change (root connect tests, `@scout/agent` 161,
  web unit tests 51).
- `pnpm typecheck` - pass.
- `pnpm lint` - pass.
- `SCOUT_E2E_PORT=47931 pnpm exec playwright test --config e2e/playwright.config.ts e2e/liked-live-flow.spec.ts`
  - red before the fix: expected heading level 3, actual accessible tree had
  `heading "Alignment update" [level=2]`; green after the fix, 1/1 passed.
- `CI=1 SCOUT_E2E_PORT=47932 pnpm exec playwright test --config e2e/playwright.config.ts e2e/liked-live-flow.spec.ts`
  - pass, 1/1.
