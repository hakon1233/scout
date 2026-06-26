# Performance & bundle-size pass — 2026-06-26 (FLI-355)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). Eleventh perf pass, following FLI-198, AIR-204, FLI-219,
FLI-239, FLI-253, FLI-266, FLI-278, FLI-317, FLI-331, FLI-343.

## Gate check (the FLI-282 process rule) — web source DID change this cycle

Unlike the last several passes, the web-bundle source **changed** since the last
real measurement (FLI-278, commit `1371368`), so this pass did a full
measurement rather than an early-exit. (Note: the change only became visible
after rebasing onto `origin/main` — two commits, AIR-300 and FLI-333, plus the
FLI-341 bug-hunt, had landed remotely.)

`git diff --stat 1371368..HEAD -- src public next.config.ts package.json
pnpm-lock.yaml postcss.config.mjs`:

```
 src/app/app/page.tsx            | 36 +++--   (extract COMPANION_NOT_PAIRED_MSG const; add canCancel prop)
 src/components/BriefHistory.tsx | 12 +--    (call canonical formatDate)
 src/components/BriefLayout.tsx  |  8 +-     (call canonical formatDate)
 src/components/FeedView.tsx     | 56 +++--  (move formatDate to lib; re-export; prettier)
 src/lib/companion.ts            | 10 ++    (try/catch around token setItem)
 src/lib/format-date.ts          | 31 ++    (new pure module — lifted from FeedView)
 src/lib/storage.ts              | 19 ++    (safeSet wrapper around setItem)
```

### Perf assessment of the delta — all behavior-preserving, zero runtime/load cost

- **AIR-300 date-formatter dedup** (`format-date.ts` + the three call-site
  edits): lifts an already-existing inline `formatDate` into one pure module and
  replaces two hand-copied duplicates. Net code is roughly neutral; no new
  dependency, no new import weight. The function is the same `Intl`/`Date` work
  it always was, called at render on a handful of brief headings — not a hot
  path.
- **FLI-333 storage guards** (`storage.ts` `safeSet`, `companion.ts` token
  try/catch): wrap `localStorage.setItem` in try/catch. Pure robustness; no
  added work on the happy path.
- **page.tsx**: extracts a string constant and threads a `canCancel` boolean to
  the progress panel (PER-139). No new effects, fetches, or render work.

No new heavy synchronous work, no new network calls/waterfalls, no new
re-render triggers, no new deps, no oversized assets.

## Measurement (fresh production build — `pnpm build`, exit 0)

| Metric | Baseline (FLI-278) | This pass (HEAD) | Δ |
| --- | --- | --- | --- |
| `out/` total | 2.7 MB | 2.7 MB | — |
| Largest JS chunk | 227 KB | 228 KB | ~0 (rounding) |
| react-markdown chunk | 112 KB, lazy | 112 KB, lazy | unchanged (still code-split) |
| Fonts | 22 woff2 | 22 woff2 | unchanged |

The react-markdown / rehype-sanitize bundle remains isolated in its own lazy
chunk (AIR-186 split intact) — the FeedView edits did not pull it into the
initial route JS. **No regression from the refactors.**

- **Tests: 137/137 pass** (`pnpm test`).
- Build: `✓ Compiled successfully`, all 14 routes prerendered static.

## All prior findings are board-tracked and open (verified, NOT re-filed)

| Finding | Issue | Status |
| --- | --- | --- |
| `ChatMarkdown` re-parses every typewriter beat | **FLI-187** | backlog |
| Companion port-sweep sequential waterfall (~7.5 s) | **FLI-188** | backlog |
| Code-split react-markdown out of remaining initial route JS | **FLI-189** | backlog |
| Dedupe companion probes on `/app` mount (in-flight token cache) | **FLI-212** | backlog |
| Stabilize two render-path values on `/app` | **FLI-213** | backlog |
| Trim 588 KB / 4-family font payload (design decision) | **FLI-233** | backlog |
| Gate the perf pass on a source diff (process fix) | **FLI-282** | backlog |

Each was confirmed still `backlog` via the issue list this pass.

## New untracked needle-movers

**None.** The source changes this cycle are behavior-preserving
refactors/bug-fixes from the architecture and bug-hunt lanes; they introduced no
new load or runtime cost, and the rebuilt bundle is byte-for-byte equivalent in
size to the baseline. Every clearly-safe win has been taken in prior passes;
remaining levers are board-tracked above or design tradeoffs.

## New measurement baseline for the next pass

The next pass's FLI-282 gate should diff against **HEAD at this commit** as the
new measured baseline (this is the first cycle since `1371368` where a real
build was run against changed source).

## Disposition: done

`done`: web source changed this cycle and was measured (fresh `pnpm build`); the
delta is perf-neutral refactors with no bundle regression (2.7 MB / 228 KB
largest chunk / react-markdown still lazy). All prior findings open and
board-tracked, tree green (137/137 tests). **FLI-282** (still open) remains the
standing fix to stop the loop firing on doc-only cycles.
