# Performance & bundle-size pass - 2026-07-14 (AIR-730)

Recurring Quality-Loop performance pass.

## Workspace note: local `main` still stale

Same stale-fork situation first flagged in AIR-668, reconfirmed every pass
since (AIR-692, AIR-703, AIR-716): local `main` (`a0eeb11`, AIR-448) is 148
commits behind and 19 commits orphaned from `origin/main`. Still deferred to
the user, untouched again this pass. Worked from a fresh branch cut directly
off `origin/main` (`air-730-performance-pass`), verified via `git
merge-base --is-ancestor HEAD origin/main` before trusting it.

## Scope

Ten real performance passes now precede this one (AIR-529, AIR-605,
AIR-617, AIR-633, AIR-668, AIR-680, AIR-692, AIR-703, AIR-716) and have
exhaustively covered `src/` and `packages/agent/src/`. This pass diffed
`origin/main` since AIR-716's audit commit (`118b30d`): four commits
landed, two docs-only —

- `708e419` "fix(companion): log transport failures on the 4 data-fetch
  paths" (AIR-626, bug-hunt pass) — adds a `logCompanionError(context, err)`
  helper in `src/lib/companion.ts`, wired into four existing `catch` blocks
  (`fetchCompanionConfig`, `fetchLatestBrief`, `fetchRunFailure`,
  `fetchBriefHistory`). Purely additive logging on already-caught error
  paths (not a hot path); no control-flow or return-value change. The two
  discovery probes (`isServedFromCompanion`, `pingPort`) were deliberately
  left silent (documented inline) since a negative probe there is routine,
  not exceptional. Perf-neutral by inspection; small measured bundle cost
  below.
- `72c4e8e` "fix(agent): default blank brief pagination params" — one-line
  guard in `packages/agent/src/routes/briefs.ts` so `?limit=&offset=`
  (blank, not omitted) falls back to the documented default instead of
  `Number("")` coercing to 0. Server-side query-param parsing, runs once
  per request, no perf impact.
- `ba05843` "docs(audit): record AIR-718 architecture & tech-debt review" —
  docs only.
- `b15768a` "docs(audit): record AIR-660 docs freshness pass" — docs only.

No dependency changes landed (`package.json`/`pnpm-lock.yaml` byte-identical
since AIR-716; confirmed via `git diff 118b30d..HEAD --stat` on the
manifests).

## Fixed this pass

None directly needed. Nothing new turned up that was both actionable and
not already tracked.

## Investigated, not fixed

- **AIR-100** (font trim — `next/font/google` weight/family payload) —
  unchanged, still `backlog`, still design-gated.
- **AIR-639** (chat transcript disk-growth cap / `since`-aware polling) —
  unchanged, still `backlog`, still contract-gated on PER-201's restart-
  persistence test.
- **AIR-551/552/553/554** — reconfirmed this pass (fourth time flagged,
  after AIR-692/AIR-703/AIR-716), still `backlog`, still cite file paths
  from the retired airbnb-assistant FSD Vite SPA (AIR-193) that don't exist
  in this repo. Four consecutive passes reconfirming the same stale items
  is a clear signal for a PM backlog-grooming pass to cancel or re-scope
  these rather than carrying them forward again.

Also spot-checked (no new findings): `<img>` vs `next/image` usage
unchanged (AIR-668's revert stands, `src/components/FeedView.tsx:291`); no
new unbounded `JSON.parse`/`stringify` outside the known AIR-639 transcript
case; `public/agent` (9.0 MB) is a local `npm pack` build artifact, git-
ignored except `.gitkeep`, not shipped to the browser — not a regression.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-716 baseline | after this pass | delta |
|---|---:|---:|---:|
| `/app/interests` | 653,336 | 653,506 | +170 |
| `/app` | 626,163 | 626,333 | +170 |
| `/app/settings` | 599,266 | 599,436 | +170 |
| `/app/liked` | 597,485 | 597,485 | +0 |
| `/app/skills` | 596,063 | 596,063 | +0 |
| `/app/connect` | 591,860 | 592,030 | +170 |
| `/app/interests/interest` | 586,560 | 586,730 | +170 |
| `/app/profile/interest` | 586,560 | 586,730 | +170 |
| `/app/profile` | 580,706 | 580,706 | +0 |
| `/app/chat` | 570,852 | 570,852 | +0 |
| `/` | 555,636 | 555,806 | +170 |

The uniform +170/+0 split traces to AIR-626's `logCompanionError` addition:
routes whose bundle already pulls in one of the four wired call sites
(`fetchCompanionConfig`/`fetchLatestBrief`/`fetchRunFailure`/
`fetchBriefHistory`) pick up the new helper function once (+170 bytes
uncompressed); routes whose companion-client usage doesn't reach those call
sites are untouched. Same shape as AIR-716's `isBrief()`/`isSettings()`
deltas — a small, deliberate, already-landed diagnostic trade-off from a
sibling bug-hunt pass, not something this pass needs to act on.

## Verification

- `CI=true pnpm build` passed (TypeScript check included, 0 errors); bundle
  re-measured post-build (above).
- `pnpm lint` passed (0 errors, 0 warnings).
- `pnpm typecheck` passed (0 errors).
- `pnpm test` passed (2 + 161 + 58 = 221/221, matching AIR-716's count —
  the two source commits since then shipped with their own coverage,
  already included).
- Public asset sizes unchanged (`public/*.png`); no new tracked assets.

## Backlog

- AIR-100 (font trim, design-gated) — unchanged, still open.
- AIR-639 (transcript disk-growth cap, contract-gated) — unchanged, still
  open, not attempted.
- AIR-551/552/553/554 — still stale, still target a retired codebase;
  flagged four passes running now (AIR-692, AIR-703, AIR-716, AIR-730) —
  recommend a PM backlog-grooming pass actually cancel or re-scope these
  rather than carrying them forward again.

No new fix-issues opened this pass — nothing new-and-actionable turned up
beyond what's already tracked.
