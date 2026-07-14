# Bug hunt & fix pass - 2026-07-14 (AIR-656)

Recurring Quality-Loop pass. Scope: find real correctness or coverage gaps,
reproduce them locally, and land the smallest fixes with fresh verification.

## Fixed

1. **Three CI E2E checks stayed disabled after the AIR-642 fixture fix.**
   `e2e/chat-undo.spec.ts`, `e2e/weekly-brief.spec.ts`, and the tarball HEAD
   check in `e2e/connect-pairing.spec.ts` still skipped under `CI=1`, citing the
   old `stub-claude.mjs` `ReferenceError: stdin is not defined` failure. Commit
   `9f47ad6` already fixed that root cause by accumulating stdin in the fixture,
   so CI was no longer exercising the live chat undo reversal, weekly brief
   assembly, or first-run tarball availability paths.

2. **Explicit companion CLI ports accepted out-of-range values.**
   `SCOUT_AGENT_PORT` already flowed through `defaultPort()` in
   `packages/agent/src/server.ts`, which rejects non-integer or out-of-range
   values and falls back to `47821`. The explicit `scout-agent run --port ...`
   path in `packages/agent/src/cli.ts` only checked `Number.isFinite`, so values
   like `99999` reached `server.listen()` and failed at the Node boundary instead
   of using the same safe fallback as the env path.

## Change

- Removed the obsolete `test.skip(!!process.env.CI, ...)` guards from:
  - `e2e/chat-undo.spec.ts`
  - `e2e/weekly-brief.spec.ts`
  - `e2e/connect-pairing.spec.ts`
- Exported the existing `defaultPort()` parser from `packages/agent/src/server.ts`.
- Reused it from `packages/agent/src/cli.ts` for `run --port`.
- Added a focused regression in `packages/agent/test/version.test.ts` covering
  `99999`, `-1`, and a valid explicit port.

## Sweep results

- `pnpm test` passed before the port-parser change: root 2, agent 161, web 59.
- `TODO/FIXME/HACK/XXX` sweep across `packages/agent/src`, `src`, root `test`,
  and `packages/agent/test`: no markers.
- Recent bug-hunt docs reviewed to avoid duplicates:
  AIR-600, AIR-663, and AIR-678.

## Verification

- Baseline before the E2E-skip cleanup:
  - `pnpm test` passed (root 2, `@scout/agent` 161, web 59).
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
- E2E-skip reproduction:
  - `CI=1 SCOUT_E2E_PORT=47944 pnpm exec playwright test --config e2e/playwright.config.ts e2e/chat-undo.spec.ts`
    reported `1 skipped`, proving the coverage was still disabled in CI mode.
- E2E-skip green:
  - `CI=1 SCOUT_E2E_PORT=47945 pnpm exec playwright test --config e2e/playwright.config.ts e2e/chat-undo.spec.ts e2e/weekly-brief.spec.ts e2e/connect-pairing.spec.ts`
    passed, 6/6.
- Port-parser red: `pnpm --filter @scout/agent exec tsx --test test/version.test.ts`
  failed on the new case because `defaultPort` was not exported yet.
- Port-parser green focused: same command passed, 6/6.
- Full required suite after the port-parser fix: `pnpm test` passed with root 2,
  `@scout/agent` 162, and web 59.
- Final import-cleanup checks:
  - `pnpm lint` passed.
  - `pnpm typecheck` passed.
  - `pnpm --filter @scout/agent exec tsx --test test/version.test.ts` passed,
    6/6.

## Notes

- A first attempt to run three Playwright commands in parallel failed before test
  execution because the shared webServer path launched concurrent `next build`
  processes, and Next correctly rejected the second build lock. That was a test
  invocation mistake, not an app regression; the verification was rerun in a
  single Playwright invocation.

## Follow-ups

No new follow-up issue opened from this pass. Both discovered issues were small,
localized, and fixed with regression coverage.
