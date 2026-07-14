# Performance & bundle-size pass - 2026-07-14 (AIR-745)

Recurring Quality-Loop performance pass.

## Scope

Thirteen real performance passes now precede this one (AIR-529, AIR-605,
AIR-617, AIR-633, AIR-668, AIR-680, AIR-692, AIR-703, AIR-716, AIR-730,
AIR-658) and have exhaustively covered `src/` and `packages/agent/src/`. This
pass follows AIR-658, the most recent performance/bundle audit landed on
`main` (commit `ee03243`) — chronologically later than AIR-730's audit
despite the lower issue number, since AIR-658 was assigned and completed
after AIR-730's branch was cut.

Cut a fresh branch directly off `origin/main` (`air-745-performance-pass`,
tip `ee3b799`) rather than continuing the stale local `air-730-performance-pass`
branch, which was 15 commits behind. Verified via
`git merge-base --is-ancestor HEAD origin/main` before trusting it.

## Delta since AIR-658

Seven commits landed since AIR-658's audit commit (`ee03243`):

- `ad1ecc4` `fix(agent): validate explicit companion CLI ports` — the only
  source change. Exports `defaultPort()` from `packages/agent/src/server.ts`
  and reuses it in `packages/agent/src/cli.ts` for the `run --port` CLI arg,
  replacing an ad hoc `Number.isFinite` check. This runs once at companion
  CLI startup (a local Node process, not the browser bundle) — no hot-path
  or bundle impact.
- `d8f3a21`, `3f8723d`, `c3f2404`, `10782ca`, `66580e6`, `ee3b799` — all
  `e2e/*` Playwright spec/fixture changes (new coverage for chat redirects,
  run-now error surfacing, brief-history pager, multi-interest targeting,
  connect-pairing dedup). Playwright specs run under `pnpm exec playwright
  test` against a dev/CI server; they are not part of `next build` output
  and carry zero production bundle weight.

No `package.json`/`pnpm-lock.yaml` change, no `src/` change, no
`public/` asset change since AIR-658.

## Fixed this pass

None directly needed. Nothing new turned up that was both actionable and
not already tracked.

## Investigated, not fixed

- **AIR-100** (font trim — `next/font/google` weight/family payload) —
  unchanged, still `backlog`, still design-gated.
- **AIR-639** (chat transcript disk-growth cap / `since`-aware polling) —
  confirmed via the tracker this pass: still `backlog`, unassigned, still
  contract-gated on PER-201's restart-persistence test.
- **AIR-551/552/553/554** — confirmed via the tracker this pass. AIR-551 is
  explicitly scoped to a different product (`airbnb-assistant`'s
  `local-persistence.ts` / `DashboardPage.tsx`, files that do not exist in
  this `scout` repo) — a wrong-repo artifact, not a live finding here. Five
  consecutive passes now (AIR-692, AIR-703, AIR-716, AIR-730, AIR-745) have
  reconfirmed the same stale cross-repo item without a PM pass acting on it;
  not re-filing again, but flagging once more that this needs cancelling or
  re-scoping at the source, not carried forward by every performance pass.

Also spot-checked (no new findings): `next.config.ts` unchanged (static
`output: "export"`, `images: { unoptimized: true }` — expected for a
static-export deploy target, previously reviewed); `public/*.png` sizes
unchanged (4.6–123 KB, last touched 2026-06-23); no new unbounded
`JSON.parse`/`stringify` outside the known AIR-639 transcript case.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-658 baseline | after this pass | delta |
|---|---:|---:|---:|
| `/app/interests` | 653,506 | 653,506 | +0 |
| `/app` | 626,748 | 626,748 | +0 |
| `/app/settings` | 599,436 | 599,436 | +0 |
| `/app/liked` | 597,900 | 597,900 | +0 |
| `/app/skills` | 596,063 | 596,063 | +0 |
| `/app/connect` | 592,030 | 592,030 | +0 |
| `/app/interests/interest` | 586,730 | 586,730 | +0 |
| `/app/profile/interest` | 586,730 | 586,730 | +0 |
| `/app/profile` | 580,706 | 580,706 | +0 |
| `/app/chat` | 570,852 | 570,852 | +0 |
| `/` | 555,806 | 555,806 | +0 |

Zero delta on every route — expected, since no `src/` file changed since
AIR-658.

## Verification

- `CI=true pnpm build` passed (Next.js 16.2.6, Turbopack, TypeScript check
  included, 0 errors); bundle re-measured post-build (above).
- `pnpm lint` passed (0 errors, 0 warnings).
- `pnpm typecheck` passed (0 errors).
- `pnpm test` passed (2 + 162 + 59 = 223/223 — `@scout/agent` count up by 1
  from AIR-730's 221, matching AIR-656's port-parser regression test that
  landed via `ad1ecc4`).
- Public asset sizes unchanged (`public/*.png`); no new tracked assets.

## Backlog

- AIR-100 (font trim, design-gated) — unchanged, still open.
- AIR-639 (transcript disk-growth cap, contract-gated) — unchanged, still
  open, not attempted.
- AIR-551/552/553/554 — confirmed wrong-repo (targets `airbnb-assistant`,
  not `scout`); flagged five passes running now. Recommend a PM
  backlog-grooming pass cancel or re-scope these rather than a sixth
  performance pass reconfirming the same thing.

No new fix-issues opened this pass — nothing new-and-actionable turned up
beyond what's already tracked.
