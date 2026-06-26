# Performance & bundle-size pass — 2026-06-26 (FLI-343)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). Tenth perf pass, following FLI-198, AIR-204, FLI-219,
FLI-239, FLI-253, FLI-266, FLI-278, FLI-317, FLI-331.

## Gate check first (the FLI-282 process rule)

Before re-measuring, I checked whether any **web-bundle source** changed since
the last real measurement (FLI-278, commit `1371368`). It did not.

- `git diff --stat 1371368..HEAD -- src public next.config.ts package.json
  pnpm-lock.yaml postcss.config.mjs` → **empty**.
- Enumeration of all 12 commits since `1371368`: every non-doc change is under
  `packages/agent/src` / `packages/agent/test`. The web app imports only
  `search-skills` and `assembly-skills` from that package
  (`src/lib/skills.ts:16-17`); neither changed. **Zero web-bundle delta.**

The agent-package diff since baseline is companion-process-only work from the
architecture/security passes — logging cleanup (CAR-225/CAR-239), malformed
static-path tolerance (AIR-266), canonical-URL digest dedupe (AIR-253),
scheduler default-config hardening, intent-doc write hardening. All run in the
loopback companion, are O(n) over a handful of stories, add no perf regression,
and are covered by the agent test suite.

## Measurement (lightweight — no rebuild churn)

Per FLI-282's intent, an unchanged web tree does **not** warrant a fresh
production build. The prior measured baseline still holds: `out/` 2.7 MB,
largest JS chunk 227 KB raw, react-markdown 112 KB lazy chunk, 22 woff2 /
554 KB fonts, no oversized assets.

Verified the tree is green instead:

- **Tests: 137/137 pass** (`pnpm test`).
- **Lint: 0 errors**, 27 pre-existing `<img>`/`no-img-element` warnings (moot
  under static export, where next/image optimization is disabled).

## All prior findings are board-tracked and open (verified, NOT re-filed)

| Finding | Issue | Status |
| --- | --- | --- |
| `ChatMarkdown` re-parses every typewriter beat | **FLI-187** | backlog |
| Companion port-sweep sequential waterfall (~7.5 s) | **FLI-188** | backlog |
| Code-split react-markdown out of remaining initial route JS | **FLI-189** | backlog |
| Dedupe companion probes on `/app` mount (in-flight token cache) | **FLI-212** | backlog |
| Stabilize two render-path values on `/app` | **FLI-213** | backlog |
| Trim 554 KB / 4-family font payload (design decision) | **FLI-233** | backlog |
| Gate the perf pass on a source diff (process fix) | **FLI-282** | backlog |

Each was confirmed still `backlog` via the issue list this pass.

## New untracked needle-movers

**None.** No web-bundle source changed since the last measurement, so no new
load/runtime cost was introduced. Every clearly-safe win has been taken in
prior passes; remaining levers are board-tracked above or design tradeoffs.

## Disposition: done

Early-exit `done`: no web-bundle source diff since FLI-278, all prior findings
open and board-tracked, tree green (137/137 tests, 0 lint errors). The
recurring null result is driven by the loop firing regardless of source diff —
**FLI-282** (still open) is the standing fix that will stop this pass from
re-deriving the same conclusion next cycle.
