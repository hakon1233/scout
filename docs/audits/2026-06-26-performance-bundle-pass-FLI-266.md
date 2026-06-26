# Performance & bundle-size pass — 2026-06-26 (FLI-266)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). This is the **sixth** perf pass in ~48 h, following
FLI-198, AIR-204, FLI-219, FLI-239, and FLI-253.

## Source state: unchanged since FLI-253

`git log` shows the only commit since FLI-253's measurement is FLI-253's own
findings doc (`8b25db3`). The shipped source tree is **byte-identical** to what
FLI-253 measured, working tree clean. A fresh production rebuild would therefore
reproduce FLI-253's numbers exactly — confirmed against the on-disk build:

- `out/` total: **2.7 MB** (unchanged).
- JS chunks: largest **228 KB** raw (`0e_akh4uop3eb.js`), markdown graph still a
  single shared **112 KB** lazy chunk (`0185oty7az51d.js`) split off the feed
  initial bundle (AIR-186 win intact).
- Fonts: **22 woff2 / 588 KB** referenced — still the largest on-the-wire asset
  class; `unicode-range` subsets mean real on-wire cost is lower.
- Assets: no oversized files (`og.png` 124 KB, icons ≤ 20 KB).

Because no source changed, a full `rm -rf .next out && pnpm build` re-run was
**not** repeated this cycle — it would burn CI for a byte-identical result
already captured by FLI-253 (lint 0 errors / 27 pre-existing warnings, test
129/129, build green, every route `○ Static`). Re-measuring an unchanged tree
is the churn this loop is meant to avoid.

## All open findings are board-tracked (verified, NOT re-filed)

Confirmed each prior-pass finding maps to an **open** board issue:

| Finding | Issue | Status |
| --- | --- | --- |
| Companion port-sweep sequential waterfall (~7.5 s) | **FLI-193** | backlog |
| `ChatMarkdown` re-parses every typewriter beat | **FLI-188** | backlog |
| 554 KB / 4-family font payload (design decision) | **FLI-114** | backlog |
| Code-split react-markdown off remaining eager routes | **FLI-166** | backlog |
| Dedupe companion probes on `/app` mount | **FLI-214** | todo |
| Stabilize render-path values on `/app` (`loadCompanionToken`) | **FLI-233** | todo |

The companion-probe coalescing (AIR-204) and feed markdown split (AIR-186) wins
remain present in source — no silent regression.

## New untracked needle-movers found this pass

**None.** Six passes have taken every clearly-safe win (1.7 MB redesign
microsite removed, markdown code-split, probe coalescing, hot-path regex
hoisting, `localeCompare` drop). The remaining levers are all either
board-tracked above or design decisions (font family/italic count → FLI-114).
All four font families are referenced via `--font-*` CSS vars in
`globals.css`; FLI-239 already proved trimming Fraunces weight 700 is
byte-neutral (shared subset files) and reverted it.

## Disposition: done

No clearly-safe code change exists this cycle that isn't already tracked or a
design tradeoff — the third consecutive pass (FLI-239, FLI-253, FLI-266) to
reach that conclusion against an unchanged tree.

**Board housekeeping signal:** running a full perf pass per heartbeat against a
static tree is now net-negative churn. Recommend the Quality-Loop driver either
**lengthen the perf-pass cadence** (e.g. trigger only when `src/`,
`public/`, or font/config changes land) or **gate it on a source diff** since
the last `docs/audits/*performance*` entry. Until the tracked backlog items
(FLI-114/166/188/193/214/233) are picked up, additional passes will keep
re-deriving this same result.
