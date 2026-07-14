# Bug hunt & fix pass - 2026-07-12 (AIR-156)

Recurring Quality-Loop pass (Engineer). Scope: real behavior bugs found by
local tests, code reading, and focused browser verification.

## Result

Fixed one user-visible theme bug from the existing QA backlog:

1. Settings theme runtime switches updated `<html class="dark">` but left
   `<html>.style.colorScheme` at the previous mode until reload. Native browser
   surfaces such as scrollbars and time inputs could therefore paint in the wrong
   mode after using the Light/Dark/System control.

## Fix

- `src/components/ThemeToggle.tsx`: `applyTheme()` now updates
  `document.documentElement.style.colorScheme` whenever it toggles the `dark`
  class, matching the first-paint `ThemeBootstrap` contract.
- `e2e/theme-toggle.spec.ts`: converted the existing skipped regression into an
  enforced Playwright test.

## Verification

- `pnpm test` - pass.
- `SCOUT_E2E_PORT=47822 pnpm test:e2e -- e2e/theme-toggle.spec.ts` - pass
  after first reproducing the red failure on the same test.

