# Bug hunt & fix pass - 2026-07-14 (AIR-656)

Recurring Quality-Loop pass. Scope: find a real correctness or coverage gap,
reproduce it locally, and land the smallest fix with fresh verification.

## Fixed

1. **Three CI E2E checks stayed disabled after the AIR-642 fixture fix.**
   `e2e/chat-undo.spec.ts`, `e2e/weekly-brief.spec.ts`, and the tarball HEAD
   check in `e2e/connect-pairing.spec.ts` still skipped under `CI=1`, citing the
   old `stub-claude.mjs` `ReferenceError: stdin is not defined` failure. Commit
   `9f47ad6` already fixed that root cause by accumulating stdin in the fixture,
   so CI was no longer exercising the live chat undo reversal, weekly brief
   assembly, or first-run tarball availability paths.

## Change

- Removed the obsolete `test.skip(!!process.env.CI, ...)` guards from:
  - `e2e/chat-undo.spec.ts`
  - `e2e/weekly-brief.spec.ts`
  - `e2e/connect-pairing.spec.ts`

## Verification

- Baseline before editing:
  - `pnpm test` passed (root 2, `@scout/agent` 161, web 59).
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
- Reproduction:
  - `CI=1 SCOUT_E2E_PORT=47944 pnpm exec playwright test --config e2e/playwright.config.ts e2e/chat-undo.spec.ts`
    reported `1 skipped`, proving the coverage was still disabled in CI mode.
- Green after the fix:
  - `CI=1 SCOUT_E2E_PORT=47945 pnpm exec playwright test --config e2e/playwright.config.ts e2e/chat-undo.spec.ts e2e/weekly-brief.spec.ts e2e/connect-pairing.spec.ts`
    passed, 6/6.

## Notes

- A first attempt to run three Playwright commands in parallel failed before test
  execution because the shared webServer path launched concurrent `next build`
  processes, and Next correctly rejected the second build lock. That was a test
  invocation mistake, not an app regression; the verification was rerun in a
  single Playwright invocation.
