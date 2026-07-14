# Performance & bundle-size pass - 2026-07-14 (AIR-692)

Recurring Quality-Loop performance pass.

## Workspace note: local `main` still stale

This workspace's local `main` is still the diverged fork AIR-668 flagged
(19 orphaned commits vs. `origin/main`, last common ancestor `b1f3486`,
AIR-204). Untouched again this pass — the reset was deferred to the user
last time and nothing has changed that decision. Worked from a fresh branch
cut directly off `origin/main` (`air-692-performance-pass`), verified via
`git merge-base --is-ancestor HEAD origin/main` before trusting it, per
AIR-668's recommendation.

## Scope

Seven real performance passes now precede this one (AIR-529, AIR-605,
AIR-617, AIR-633, AIR-668, AIR-680) and have exhaustively covered `src/` and
`packages/agent/src/` — bundle composition, re-renders, poll waterfalls,
images/fonts, agent-backend hot paths. This pass diffed `origin/main` since
AIR-680's audit commit (`866af9a`): **one** commit, `82f1c4e` "copy(profile):
unify interest doc naming on 'assignment' (AIR-441)" — a pure JSX string-
literal rename across 6 profile/interests files (`InterestDocCard.tsx`,
`InterestScopeView.tsx`, `ChatDock.tsx`, `useProfileWorkbench.helpers.ts`,
`interests/page.tsx`, `profile/interest/page.tsx`); every changed line is
copy text ("intent doc" → "assignment"), no logic, hooks, effects, memoization,
or fetch/render-shape changes. Perf-neutral by inspection, confirmed by
re-measurement below. `packages/agent/src` has had zero commits since
AIR-633's audit; `src/app/layout.tsx` (font config) has had zero commits
since AIR-218's baseline measurement.

## Fixed this pass

None. No performance-relevant change landed since AIR-680; nothing to fix.

## Investigated, not fixed

- **AIR-100** (font trim — `next/font/google` weight/family payload) —
  unchanged, still accurate, still design-gated. Routed to the Designer lane
  as before.
- **AIR-639**'s remaining half (chat transcript on-disk growth cap) — still
  correctly left as its own reviewed change, not a same-pass drive-by. Re-read
  the constraint this pass: `packages/agent/test/chat.test.ts`'s PER-201 test
  is literally titled *"GET /v0/chat returns the full persisted transcript
  after companion restart"* — capping stored turns is a breaking contract
  change against an explicit, named test guarantee, not a mechanical tweak.
  Needs a deliberate decision (what "full" should mean once capped, whether
  the test itself is updated) before any code moves.

## New finding — 4 open backlog issues target a retired, different codebase

While checking the open-issue backlog to avoid re-filing tracked work, found
**AIR-551, AIR-552, AIR-553, AIR-554** (all `backlog`, filed 2026-07-07,
labelled "[deep-audit airbnb-assistant/B]"). All four cite file paths that do
not exist in this repo — `src/main.tsx`, `src/entities/persistence/model/
local-persistence.ts`, `src/app/providers/PropertyContext.tsx`,
`src/pages/dashboard/ui/DashboardPage.tsx`, `src/shared/lib/query-client.ts`,
`@fontsource/inter/*.css` — confirmed by `find`/`grep`: none of those paths
exist, and there's no `@fontsource` dependency anywhere in `package.json` or
`packages/agent/package.json`. This repo's `src/` is a flat Next.js App
Router tree (`src/app`, `src/components`, `src/hooks`, `src/lib`); the cited
paths are a feature-sliced-design Vite SPA — almost certainly the retired
"rental-pricing"/airbnb-assistant product AIR-193 already groomed ~25 stale
issues away from ("verify & cancel stale issues that target the retired
rental-pricing product (not Scout)"). These four just weren't caught by that
sweep. Not cancelling them myself (backlog grooming is the PM lane, not
mine) — flagging here so a future performance pass doesn't burn time
re-investigating findings that can't reproduce against this repo, and so
PM's next grooming pass picks them up.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-680 baseline | after this pass | delta |
|---|---:|---:|---:|
| `/app/interests` | 652,924 | 653,020 | +96 |
| `/app/connect` | 591,116 | 591,330 | +214 |
| `/app` | 625,761 | 625,847 | +86 |
| `/app/interests/interest` | 585,956 | 586,030 | +74 |
| `/app/profile/interest` | 585,956 | 586,030 | +74 |
| `/app/profile` | 581,348 | 581,348 | +0 |
| `/app/settings` | 599,822 | 599,908 | +86 |
| `/app/liked` | 598,127 | 598,127 | +0 |
| `/app/skills` | 596,705 | 596,705 | +0 |
| `/app/chat` | 571,280 | 571,280 | +0 |
| `/` | 555,764 | 555,850 | +86 |

The 0–214 byte deltas track exactly which routes render the renamed strings
("assignment" is longer than "intent doc" / "research scope" in most call
sites) — expected string-literal growth from the AIR-441 copy change, not a
regression. No route moved by more than 0.04%.

## Verification

- `CI=true pnpm build` passed (TypeScript check included, 0 errors); bundle
  re-measured post-build (above).
- `pnpm lint` passed (0 errors, 0 warnings).
- `pnpm test` passed (2 + 161 + 52 = 215/215).
- Public asset sizes re-checked: `og.png` (123 KB) is still the only asset
  over a few KB; no new assets landed.

## Backlog

- AIR-100 (font trim, design-gated) — unchanged, still open.
- AIR-639 (transcript disk-growth cap, contract-gated) — unchanged, still
  open, not attempted.
- AIR-551/552/553/554 — new finding this pass: stale, target a different
  (retired) codebase; recommend cancelling or re-scoping via a backlog-
  grooming pass rather than a performance pass.
