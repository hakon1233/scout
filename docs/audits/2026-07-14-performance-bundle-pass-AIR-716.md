# Performance & bundle-size pass - 2026-07-14 (AIR-716)

Recurring Quality-Loop performance pass.

## Workspace note: local `main` still stale

Same stale-fork situation first flagged in AIR-668, reconfirmed every pass
since (AIR-692, AIR-703): local `main` is now 19 commits orphaned from
`origin/main` (last common ancestor `b1f3486`, AIR-204) — 141 commits behind
`origin/main`. Still deferred to the user; untouched again this pass. Worked
from a fresh branch cut directly off `origin/main` (`air-716-performance-pass`),
verified via `git merge-base --is-ancestor HEAD origin/main` before trusting
it.

## Scope

Nine real performance passes now precede this one (AIR-529, AIR-605,
AIR-617, AIR-633, AIR-668, AIR-680, AIR-692, AIR-703) and have exhaustively
covered `src/` and `packages/agent/src/`. This pass diffed `origin/main`
since AIR-703's audit commit (`f277c89`): five commits landed, two of them
(`27cc55c`, `53d2c49`) concurrently from sibling Quality-Loop passes while
this one was in flight (rebased onto them before pushing) —

- `8afb3fd` "fix(storage): reject malformed saved settings" — adds an
  `isSettings()` shape guard to `loadSettings()` in `src/lib/storage.ts`.
  Runs once per settings load (not a hot path); cost is a handful of
  `typeof`/`Array.isArray` checks over a small object. Perf-neutral.
- `9473525` "refactor(nav): extract shared useDisclosure hook for the two
  nav popovers" (AIR-705, CTO architecture pass) — hoists the byte-identical
  disclosure-popover state/effect block out of `FeedFilter` and
  `ProfileMenu` in `src/components/AppNav.tsx` into one shared
  `useDisclosure()` hook. Behavior-preserving, net -14 lines. `AppNav` ships
  on every `/app/*` route, so the dedup shows up as a small first-load JS
  reduction across the board (measured below) — a genuine, if modest, win
  that landed as a side effect of an architecture pass rather than this one.
- `71b2f1f` "docs(audit): record AIR-705 architecture & tech-debt review" —
  docs only.
- `27cc55c` "fix(storage): reject malformed cached briefs" (landed
  concurrently, same shape as `8afb3fd` but for `loadLastBrief()`) — adds an
  `isBrief()` guard in `src/lib/storage.ts`. Same profile: runs once per
  brief load, not a hot path. Adds ~791 bytes of client JS, but only to the
  routes that actually import brief-loading (`/app`, `/app/interests`,
  `/app/connect`, the two `interest` detail routes) — everything else is
  byte-identical. A reasonable, small trade of bytes for input-validation
  robustness; not flagged as a regression.
- `53d2c49` "docs(audit): AIR-712 security dependency hygiene pass
  findings" — docs only, no source change.

No other `src/` or `packages/agent/src/` commits landed since AIR-703.

## Fixed this pass

None directly — nothing new needed fixing. The one bundle-size improvement
this pass measures (see below) was a side effect of AIR-705's architecture
refactor, already landed on `main`.

## Investigated, not fixed

- **AIR-100** (font trim — `next/font/google` weight/family payload) —
  unchanged, still `backlog`, still design-gated.
- **AIR-639** (chat transcript disk-growth cap / `since`-aware polling) —
  unchanged, still `backlog`, still contract-gated on PER-201's restart-
  persistence test.
- **AIR-551/552/553/554** — reconfirmed this pass (third time flagged,
  after AIR-692 and AIR-703), still `backlog`, still cite file paths
  (`src/main.tsx`, `src/app/providers/PropertyContext.tsx`,
  `src/pages/competitors/ui/CompetitorsPage.tsx`, `@fontsource/inter/*`,
  `zod` on the landing route) that don't exist in this repo — confirmed
  again this pass: `zod` isn't even a dependency here. Same retired
  airbnb-assistant FSD Vite SPA (AIR-193) as flagged twice before. Still
  flagging rather than cancelling (backlog grooming is the PM lane) — but
  three consecutive passes reconfirming the same four stale items is itself
  a signal worth a PM look.

Also spot-checked (no new findings): `<img>` vs `next/image` usage is
unchanged and intentional (AIR-668's revert stands — the three spots use
plain `<img>` for unpredictable remote lead images, documented inline at
`src/components/FeedView.tsx:291`); no raw `JSON.parse`/`stringify` of
unbounded blobs outside the known AIR-639 transcript case; memoization
(`useMemo`/`useCallback`/`memo`) coverage across `src/` is unchanged (48
call sites); no new `zod` or other unexpectedly heavy dependency landed.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-703 baseline | after this pass | delta |
|---|---:|---:|---:|
| `/app/interests` | 653,020 | 653,336 | +316 |
| `/app/connect` | 591,330 | 591,860 | +530 |
| `/app` | 625,847 | 626,163 | +316 |
| `/app/interests/interest` | 586,030 | 586,560 | +530 |
| `/app/profile/interest` | 586,030 | 586,560 | +530 |
| `/app/profile` | 581,348 | 580,706 | -642 |
| `/app/settings` | 599,908 | 599,266 | -642 |
| `/app/liked` | 598,127 | 597,485 | -642 |
| `/app/skills` | 596,705 | 596,063 | -642 |
| `/app/chat` | 571,280 | 570,852 | -428 |
| `/` | 555,850 | 555,636 | -214 |

Net effect of the two independent changes: routes that load briefs
(`/app`, `/app/interests`, `/app/connect`, both `interest` detail routes)
gained ~791 bytes from `27cc55c`'s `isBrief()` guard and lost 475/261 bytes
from AIR-705's `AppNav` dedup, netting +316/+530; routes that don't touch
brief-loading only saw AIR-705's reduction (-214 to -642). No regression —
both deltas are small, deliberate, already-landed trade-offs from sibling
passes, not something this pass needs to act on.

## Verification

- `CI=true pnpm build` passed (TypeScript check included, 0 errors); bundle
  re-measured post-build (above).
- `pnpm lint` passed (0 errors, 0 warnings).
- `pnpm typecheck` passed (0 errors).
- `pnpm test` passed (2 + 161 + 58 = 221/221 — up from AIR-703's 215; the 6
  new tests are `8afb3fd`'s `isSettings()` and `27cc55c`'s `isBrief()`
  coverage in `storage.test.ts`).
- Public asset sizes unchanged (`public/*.png`); no new assets landed.

## Backlog

- AIR-100 (font trim, design-gated) — unchanged, still open.
- AIR-639 (transcript disk-growth cap, contract-gated) — unchanged, still
  open, not attempted.
- AIR-551/552/553/554 — still stale, still target a retired codebase;
  flagged three passes running now (AIR-692, AIR-703, AIR-716) — recommend
  a PM backlog-grooming pass actually cancel or re-scope these rather than
  carrying them forward again.

No new fix-issues opened this pass — nothing new-and-actionable turned up
beyond what's already tracked.
