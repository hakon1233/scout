# AIR-526 Design / UX Audit

Date: 2026-07-08

Scope: Scout web app routes `/`, `/app/`, `/app/interests/`, `/app/settings/`,
`/app/liked/`, `/app/skills/`, and `/app/connect/`, plus a targeted code review
of components not named in prior passes' findings (`ScheduleSettings`,
`SkillSection`, `BriefHistory`, `LikeButton`, `Toggle`, `Field`, `Button`,
`EmptyState`, `ChatActionCard`, `ChatDeleteConfirm`, `AgentProgressPanel`,
`PairedEntryRedirect`). No paid Apify scrape was run; browser checks used
localStorage fixtures. This pass ran ~15 minutes after AIR-511 (same Quality
Pass cycle window), so the product code was essentially unchanged from that
audit except for the AIR-441 copy commit already on this branch.

## Summary

The headline finding this pass isn't a visual defect — it's that **the local
`pnpm dev` server silently fails to hydrate at all** in this environment: every
route renders correct-looking HTML with zero console/page errors, but no
click handler anywhere in the app ever fires (verified by checking for React
fiber properties on live DOM nodes — there are none, even after 20s). The
production static-export build (`pnpm build` + serve) hydrates and is fully
interactive. Root cause and a verified one-line fix are in AIR-542. This also
explains why AIR-511's P1 hydration-*mismatch* finding (AIR-486) did not
reproduce in this pass: if hydration never starts, there's nothing to
mismatch against. AIR-486 is not resolved — its underlying code is unchanged —
just currently unobservable until AIR-542 lands.

Beyond that, AIR-441's "assignment" copy unification (landed since AIR-511)
was spot-checked across `InterestDocCard`, `InterestScopeView`, the interests
page, `ChatDock`, and the workbench greeting — fully consistent, no leftover
"intent doc"/"research scope"/"interest scope" strings in user-facing copy.
A targeted review of components not named in AIR-460/470/511's findings
turned up four small, real issues (one copy, one off-brand token drift, one
latent a11y bug in an unused primitive, one unnecessary loading-state flash)
— all filed below. No other new accessibility, empty/error-state, or
off-brand issues were found; the backlog from prior passes (AIR-237, 261,
274, 275, 276, 277, 278, 334, 347, 348, 373, 391, 392, 486, 487, and others)
remains open and was not re-filed.

## Findings

### P1 (routed HIGH): Local dev server never hydrates — every control is a dead affordance
See **AIR-542**. `pnpm dev` serves correct HTML and every JS chunk loads, but
React never attaches (no fiber props on any DOM node; clicks on the theme
toggle, the interests-page segmented tab, etc. do nothing) — with no error of
any kind. Isolated to Next 16's `allowedDevOrigins` dev guard rejecting the
HMR websocket in this proxied sandbox (`⚠ Blocked cross-origin request to
Next.js dev resource /_next/webpack-hmr from "127.0.0.1"` in the dev log).
Verified fix: add `allowedDevOrigins: ["127.0.0.1", "localhost"]` to
`next.config.ts` — confirmed this restores hydration end-to-end. The shipped
static-export build is unaffected (tested directly: `pnpm build` + `npx serve
out/` hydrates and is interactive without the fix). This is why three prior
Design/UX audits missed it: they checked screenshots and console output, not
click interactivity.

### P3: ChatActionCard "Undo" caption is internal jargon
See **AIR-543**. "Steers your next run" doesn't say what Undo does; sibling
cards in the same dock use clearer copy ("Nothing happens until you choose").

### P3: Skills page heading drifts off the `text-title-2` token
See **AIR-544**. `SkillSection.tsx` hand-rolls `font-serif text-[24px]
leading-tight` instead of `text-title-2`, silently losing the token's weight
and tracking — visible on `/app/skills/` and the Skills setup block on
`/app/interests/`.

### P3 (latent, no live callers): `ui/Field.tsx` id generation isn't hydration-safe
See **AIR-545**. Uses a module-level counter instead of `useId()`. No current
callers, so no live impact, but it will throw a hydration mismatch the moment
one is added. One-line fix.

### P3: ScheduleSettings Retry causes an unnecessary full-panel loading flash
See **AIR-546**. Retry re-runs the whole `load()` (full skeleton) instead of
just retrying the failed save, even though the save path already re-syncs on
error.

## Not Re-filed

Confirmed still open/tracked from prior passes, not re-filed: AIR-237
(AppNav dropdown keyboard model), AIR-261 (connect terminal hex), AIR-274
(`bg-surface-strong` undefined token), AIR-275 (InterestDocCard nested
link/button), AIR-276 (chat docs scrim hardcoded rgba), AIR-277 (sub-token
tiny type in chat/profile cards — also grepped app-wide this pass, no new
occurrences found outside this cluster and the connect page), AIR-278 (empty
feed CTA copy mismatch), AIR-334 (global-error light-only), AIR-347 (logo
hover scale), AIR-348 (masthead Privacy link), AIR-373/391/392 (connect flow
a11y), AIR-486 (theme hydration mismatch — see note above, still real, just
unobservable until AIR-542 lands), AIR-487 (mobile composer clipping).
AIR-440 and AIR-442 are `in_review` (already fixed, awaiting review).

A repo-wide grep for raw hex/`rgba(...)` literals and `text-[9px]`/`text-[10px]`
sub-token type outside the already-tracked chat/profile/connect cluster
turned up nothing new. A grep for `onClick` on non-interactive elements
without a role/keyboard handler also came back empty app-wide.

## Verification

- Started a clean local Next dev server (`pnpm approve-builds` for
  esbuild/sharp/unrs-resolver, then `pnpm dev`; selected port 3002).
- Captured desktop (1440×1000) and mobile (390×844) Playwright screenshots
  across the audited routes with seeded localStorage fixtures; reviewed all
  for visual regressions (none found).
- Diagnosed the dev-hydration failure directly: checked for
  `__reactFiber$…`/`__reactProps$…` properties on live DOM nodes (absent),
  dispatched both Playwright and raw in-page `element.click()` calls on
  multiple controls (no state change, no error), inspected network responses
  (all JS chunks 200 OK), then bisected to `allowedDevOrigins` and confirmed
  the fix by restarting dev and re-testing the same click, and separately by
  building + serving the static export (`pnpm build`, `npx serve out/`) to
  confirm production is unaffected.
  All scratch scripts and temporary `next.config.ts`/source edits used for
  this diagnosis were reverted; nothing from the investigation is committed
  except this doc and the filed issues.
- Recovered and committed two prior audits' docs/screenshots
  (AIR-470, AIR-511) that had been left uncommitted in this shared
  workspace.
- No app source was changed by this pass; no build/lint/test run was needed
  since no code shipped from this issue itself.
