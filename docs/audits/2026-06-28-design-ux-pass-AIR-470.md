# AIR-470 Design / UX Audit

Date: 2026-06-28

Scope: Scout web app routes `/`, `/app/`, `/app/interests/`, `/app/settings/`, `/app/liked/`, `/app/skills/`, and `/app/connect/` in the local Next dev server. No paid Apify scrape was run. Browser checks used the built-in sample brief and localStorage fixtures only.

## Summary

Scout's current brand direction is coherent: the warm paper canvas, editorial serif headings, mono datelines, restrained signal red, and compact card shapes hold together across the landing page, feed, interests workbench, settings, skills, liked, and connect routes. Most primary controls have visible focus states, icon-only buttons are labelled, and empty states are written in the right voice.

Two concrete UX defects are worth fixing now:

1. Theme bootstrap still causes a React hydration mismatch in dev, which can throw the app into the Next error overlay and obscures the actual UI during local use.
2. The mobile interests/chat composer clips its helper text at the bottom of the viewport, making the primary first-run chat workflow feel unfinished.

## Findings

### P1: Theme bootstrap mutates `<html style>` before hydration

Evidence:
- Reproduced on `http://localhost:3002/`, `/app/`, `/app/settings/`, `/app/liked/`, `/app/skills/`, and `/app/connect/`.
- Console error: `A tree hydrated but some attributes of the server rendered HTML didn't match the client properties`.
- Diff points at `<html ... style={{color-scheme:"light"}}>`.
- Source path: `src/components/ThemeToggle.tsx` `ThemeBootstrap()` sets `e.style.colorScheme = d ? "dark" : "light"` before React hydrates, while `src/app/layout.tsx` renders `<html>` without that style.
- Prior duplicate check: AIR-408 "Resolve theme color-scheme hydration mismatch" is `done`, so this appears to be a regression or incomplete fix rather than an open duplicate.

Impact:
Local users and engineers can land on a full-screen Next error overlay before seeing Scout. It also makes browser QA noisy because every route reports a framework-level hydration problem.

Suggested fix:
Keep the no-flash theme behavior, but make the server and first client render agree. Options: render a matching `style={{ colorScheme: "light dark" }}` or `suppressHydrationWarning` on `<html>` if this mutation is intentionally pre-hydration-only; verify in dev and production preview.

### P2: Mobile interests/chat composer is clipped

Evidence:
- Reproduced at 390 x 844 on `/app/interests/` with the empty chat state.
- The sticky composer sits against the bottom edge; the helper line (`Enter to send ...`) is partially cut off in the screenshot.
- Source path: `src/components/profile/ChatDock.tsx` composer container uses safe-area bottom padding, while the page shell in `src/app/app/interests/page.tsx` uses `height: 100svh`; the combination leaves too little bottom room in the mobile screenshot.
- Duplicate check: no open "mobile composer" issue found. Nearby chat/design issues AIR-277 and AIR-276 cover tiny type and token usage, not viewport clipping.

Impact:
This is the first-run interaction on mobile: the user is prompted to tell Scout what to track, but the input area reads as visually broken before the first message is sent.

Suggested fix:
Give the composer/footer a stable minimum bottom clearance on mobile, or move helper text inside the composer frame where it cannot be clipped. Verify at 390 x 844 and a shorter viewport.

## Not Re-filed

- Chat tiny type and sub-token styling are already tracked by AIR-277.
- Chat docs scrim token/dark-mode concern is already tracked by AIR-276.
- Interest-scope/refine navigation copy and context issues are already tracked by AIR-422 and AIR-441.
- Connect pairing-token labels are already tracked by AIR-405.

## Verification

- Started local Next dev server; it selected `http://localhost:3002` because port 3000 was busy.
- Captured desktop and mobile Playwright screenshots for the audited routes.
- Reviewed source for the theme bootstrap, app layout, app nav menus, feed cards, liked stories, and chat composer.
