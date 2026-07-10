# Performance & bundle-size pass — 2026-06-26 (FLI-253)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). This is the **fourth** perf pass in ~48 h, following
FLI-198 (`2026-06-25-performance-bundle-pass.md`), AIR-204
(`...-AIR-204.md`), FLI-219 and FLI-239. The first two took the headline wins
(1.7 MB redesign microsite removed, `react-markdown` code-split off the feed,
companion-probe coalescing, hot-path regex hoisting); FLI-219/239 re-measured
and grounded the font question to byte truth. This pass re-measures the current
build, re-verifies the prior wins still hold in source, and re-scans for any
**untracked** clearly-safe win.

## What was measured (fresh production build, `rm -rf out .next` first)

- `pnpm typecheck` clean.
- `pnpm lint` **0 errors** (27 warnings — all pre-existing `no-unused-vars` on
  intentional `_bin`/`_args`/`_opts` mock params in `packages/agent` test
  fakes; not runtime code).
- `pnpm test` **129/129** pass (was 128 at FLI-219 — one test added since; all
  green).
- `pnpm build` green; every route prerendered `○ (Static)`.
- **Static export (`out/`)**: **2.7 MB** (unchanged).
- **JS**: **1068 KB raw / 326 KB gzip** across all chunks (FLI-219 measured
  ~301 KB gzip; within noise of chunk-hash churn — no regression in route
  graphs).
- **Fonts**: **588 KB across 22 woff2 files** — still the largest on-the-wire
  asset class. woff2 is already compressed; `unicode-range` subsets mean a
  browser only fetches the subranges it renders, so real on-wire cost is lower.
- **Assets**: no oversized files. Largest is `og.png` 124 KB (appropriate for
  an OG card); all app icons ≤ 20 KB. No embedded large JSON/data modules
  (`sample-brief.ts` is 78 lines; largest `src` module is `companion.ts` at
  28 KB of code, not data).

## Verified: prior wins still hold (source-level)

- **Feed markdown is split.** `FeedView.tsx` loads `FeedBody` (the only
  feed-side `react-markdown` + `rehype-sanitize` importer, ~112 KB graph) via
  `next/dynamic` (AIR-186). The markdown graph compiles to a single shared lazy
  chunk (`out/_next/static/chunks/0185oty7az51d.js`, 112 KB) — confirmed off the
  `/app` feed initial bundle.
- **Companion network layer is coalesced.** `companion.ts` keeps a shared
  in-flight `/healthz` probe (`servedProbeInFlight`), a TTL+in-flight cache for
  `/v0/config` (`configInFlight`/`configCache`, 3 s TTL — AIR-204), and a
  `cachedBase` so `discoverCompanion()` skips the loopback port sweep after the
  first hit. No new per-call refetch or waterfall introduced.
- No `Promise.all` waterfalls regressed; the API surface is request-per-action
  by design (each user action is one POST/GET), not an N+1 fan-out.

## New untracked needle-movers found this pass

**None.** The remaining 112 KB markdown graph is still eager on the
profile/chat/interests routes — but there it backs **primary content** (interest
documents in `InterestDocCard`/`InterestScopeView`, chat messages in
`ChatMarkdown`). Lazy-loading it there would trade a flash-of-unstyled-content
on every render for a chunk that's needed on first paint anyway — net-negative,
not a clean safe win. The one route where this is worth doing (`/app/interests`,
where the doc is below the setup fold) is **already tracked by AIR-194**; not
re-filed.

## Still-valid tracked items (NOT re-filed)

- `AIR-194` — lazy markdown on `/app/interests` (the one route where the split
  is clean).
- `AIR-173` — back off the companion poll once the brief is ready.
- `AIR-174` — memoize brief-derived work in the `/app` render.
- `AIR-178` — cap chat-transcript growth.
- Font family / italic-face count — design decision filed by FLI-219 for the
  type-system owner (Designer/CTO).

## Disposition

Green re-measurement, no regression, prior wins intact. No clearly-safe code
change exists this cycle that isn't already tracked or a UX/design tradeoff —
consistent with FLI-239's conclusion one cycle earlier. The product remains in
good shape for a static export of this size. This pass's durable value is the
fresh byte-level re-measurement (so the next pass can diff against it) and the
source-level confirmation that the AIR-186/AIR-204 splits have not silently
regressed. No new fix-issues filed (would be churn or duplicate tracked work).
