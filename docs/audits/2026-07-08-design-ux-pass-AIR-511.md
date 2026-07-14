# AIR-511 Design / UX Audit

Date: 2026-07-08

Scope: Scout web app routes `/`, `/app/`, `/app/interests/`, `/app/settings/`,
`/app/liked/`, `/app/skills/`, and `/app/connect/` in the local Next dev
server at `http://localhost:3002`. No paid Apify scrape was run. Browser checks
used localStorage fixtures for settings and a sample brief.

## Summary

Scout's editorial direction still reads coherently: warm paper canvas, ink
type, signal-red metadata, compact story cards, and restrained app chrome are
consistent across the checked routes. The current app surfaces have no horizontal
overflow at 1440 x 1000 or 390 x 844, the main routes expose sensible headings,
and the fixture-fed feed, liked stories, skills, settings, connect, and
interests/chat screens all render.

One high-signal regression remains visible in this pass: the theme bootstrap
mutates `<html style>` before React hydration, so every audited route reports a
React hydration mismatch in dev. The Next dev overlay badge is visible in the
rendered UI and covers part of the mobile app/chat area, making local QA and
first-run development feel broken.

## Findings

### P1: Theme color-scheme hydration mismatch still appears on every route

Evidence:
- Reproduced on desktop and mobile for `/`, `/app/`, `/app/interests/`,
  `/app/settings/`, `/app/liked/`, `/app/skills/`, and `/app/connect/`.
- Console error on every route: React reports that server-rendered `<html>` did
  not match the client because `style={{color-scheme:"light"}}` was present on
  the client-mutated node but not in the server markup.
- Source path: `src/components/ThemeToggle.tsx` `ThemeBootstrap()` sets
  `e.style.colorScheme=d?'dark':'light'` before hydration, while
  `src/app/layout.tsx` renders `<html>` without a matching style or hydration
  suppression.
- Screenshots and console log captured in `docs/audits/air-511-shots/`.

Impact:
The app content does render, but the visible Next dev overlay badge becomes part
of every local visual check. On mobile it sits over the feed/chat bottom area,
which can hide real layout defects and makes the primary first-run chat workflow
look broken during development.

Suggested fix:
Keep the no-flash theme bootstrap, but make server and first client markup agree.
Likely options are rendering a stable initial `colorScheme` style on `<html>` or
using `suppressHydrationWarning` on `<html>` if the pre-hydration mutation is
intentional and isolated. Verify in dev on at least `/`, `/app/`, and
`/app/interests/` with the console clear.

Tracking:
This is already tracked by open backlog issue AIR-486, filed from the prior
AIR-470 audit after AIR-408 was completed. I did not create a duplicate.

## Not Re-filed

- AppNav feed/settings dropdowns still use `role="menu"` without a full menu
  keyboard model; this was already tracked in prior audit notes as AIR-237.
- Theme toggle radio groups still lack arrow-key radio behavior; already tracked
  as AIR-442.
- Tiny chat/action microtype remains present in chat support controls; already
  tracked as AIR-277.
- `bg-surface-strong` still appears in run/filter/menu active states without a
  declared token; already tracked as AIR-274.
- Connect terminal command styling still uses raw hex values; already tracked as
  AIR-261.
- Global error remains light-only/generic; already tracked as AIR-334 and
  AIR-440.

## Verification

- Started local Next dev server; it selected `http://localhost:3002` because
  port 3000 was already in use.
- Approved pnpm dependency build scripts for `esbuild`, `sharp`, and
  `unrs-resolver` after pnpm 11 rebuilt `node_modules`.
- Captured desktop and mobile Playwright screenshots for the audited routes.
- Reviewed UI code against the Web Interface Guidelines source fetched on
  2026-07-08.
- No code tests were run because this pass produced audit documentation and
  referenced the existing AIR-486 fix issue, not an app-code change.
