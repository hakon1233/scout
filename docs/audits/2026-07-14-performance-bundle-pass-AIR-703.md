# Performance & bundle-size pass - 2026-07-14 (AIR-703)

Recurring Quality-Loop performance pass.

## Workspace note: local `main` still stale

Same stale-fork situation AIR-668 first flagged, reconfirmed by AIR-692:
local `main` is 19 commits orphaned from `origin/main` (last common
ancestor `b1f3486`, AIR-204), deferred to the user, untouched again this
pass. Worked from a fresh branch cut directly off `origin/main`
(`air-703-performance-pass`), verified via `git merge-base --is-ancestor
HEAD origin/main` before trusting it.

## Scope

Eight real performance passes now precede this one (AIR-529, AIR-605,
AIR-617, AIR-633, AIR-668, AIR-680, AIR-692) and have exhaustively covered
`src/` and `packages/agent/src/`. This pass diffed `origin/main` since
AIR-692's audit commit (`1bc6f68`): **one** commit, `2bd3ef3` "test(e2e):
isolate unpaired companion sweep" — widens a Playwright fixture's mocked
`/healthz` route from the single serving-origin port to every port in the
companion's loopback sweep list (`e2e/connect-pairing.spec.ts` only, +12/-7
lines). Test-fixture-only: no `src/`, no `packages/agent/src/`, no
production route touched. Perf-neutral by inspection and by
re-measurement — `packages/agent/src` has had zero commits since AIR-633's
audit; `src/app/layout.tsx` (font config) has had zero commits since
AIR-218's baseline.

## Fixed this pass

None. No performance-relevant change landed since AIR-692; nothing to fix.

## Investigated, not fixed

- **AIR-100** (font trim — `next/font/google` weight/family payload) —
  unchanged, still open, still design-gated.
- **AIR-639** (chat transcript disk-growth cap / `since`-aware polling) —
  unchanged, still open, still contract-gated on PER-201's restart-
  persistence test.
- **AIR-551/552/553/554** — reconfirmed this pass, still `backlog`, still
  cite file paths (`src/main.tsx`, `src/app/providers/PropertyContext.tsx`,
  `src/pages/competitors/ui/CompetitorsPage.tsx`, `@fontsource/inter/*`)
  that don't exist in this repo. Same retired airbnb-assistant FSD Vite SPA
  (AIR-193) as flagged in AIR-692; none of the four have moved since. Still
  flagging rather than cancelling (backlog grooming is the PM lane).

No new findings this pass — the source tree is effectively frozen for
performance purposes since AIR-680; AIR-692 and this pass both landed on a
single, unrelated, non-perf commit apiece.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-692 baseline | after this pass | delta |
|---|---:|---:|---:|
| `/app/interests` | 653,020 | 653,020 | +0 |
| `/app/connect` | 591,330 | 591,330 | +0 |
| `/app` | 625,847 | 625,847 | +0 |
| `/app/interests/interest` | 586,030 | 586,030 | +0 |
| `/app/profile/interest` | 586,030 | 586,030 | +0 |
| `/app/profile` | 581,348 | 581,348 | +0 |
| `/app/settings` | 599,908 | 599,908 | +0 |
| `/app/liked` | 598,127 | 598,127 | +0 |
| `/app/skills` | 596,705 | 596,705 | +0 |
| `/app/chat` | 571,280 | 571,280 | +0 |
| `/` | 555,850 | 555,850 | +0 |

Byte-for-byte identical across every route — expected, since the only
intervening commit touched `e2e/` only.

## Verification

- `CI=true pnpm build` passed (TypeScript check included, 0 errors); bundle
  re-measured post-build (above, byte-identical to AIR-692).
- `pnpm lint` passed (0 errors, 0 warnings).
- `pnpm typecheck` passed (0 errors).
- `pnpm test` passed (2 + 161 + 52 = 215/215), matching AIR-692's count.
- Public asset sizes unchanged; no new assets landed.

## Backlog

- AIR-100 (font trim, design-gated) — unchanged, still open.
- AIR-639 (transcript disk-growth cap, contract-gated) — unchanged, still
  open, not attempted.
- AIR-551/552/553/554 — still stale, still target a retired codebase;
  recommend cancelling or re-scoping via a backlog-grooming pass.
