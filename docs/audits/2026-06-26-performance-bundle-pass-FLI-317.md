# Performance & bundle-size pass — 2026-06-26 (FLI-317)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). Eighth perf pass, following FLI-198, AIR-204, FLI-219,
FLI-239, FLI-253, FLI-266, FLI-278.

## Gate check first (the lesson from FLI-278 / FLI-282)

Before re-measuring, I checked whether any **web-bundle source** actually
changed since the last real measurement (FLI-278, commit `1371368`). It did not.

- Rebased local `main` onto `origin/main` (clean, 10 commits ahead, no
  conflicts).
- `git diff --stat 1371368..HEAD -- src public next.config.ts package.json` →
  **empty**.
- Full path enumeration of the 10 new commits: all are `packages/agent/**`
  (loopback companion daemon — scheduler/runner/state/static/weekly/docs) plus
  `docs/audits/**`. None of the changed agent files are imported by the web app
  (`src/lib/skills.ts` only pulls `search-skills`/`assembly-skills`, neither of
  which changed). **Zero web-bundle delta.**

The agent-package changes (e.g. `weekly.ts` canonical-URL dedupe AIR-253,
scheduler default-config hardening) run only in the companion process, are
O(n) over a handful of stories, and introduce no perf regression. They are
covered by the agent test suite.

## Measurement (lightweight — no rebuild churn)

Per FLI-282's intent, an unchanged web tree does **not** warrant a fresh
production build (the prior pass already measured this exact tree: `out/`
2.7 MB, largest JS chunk 227 KB raw, react-markdown 112 KB lazy chunk, 22
woff2 / 554 KB fonts, no oversized assets). Re-running it would be the churn
FLI-282 was filed to stop.

Verified the tree is green instead:

- **Tests: 137/137 pass** (`pnpm test`) — up from 134; the delta is new agent
  coverage (scheduler/static/weekly), not web code.
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

## New untracked needle-movers

**None.** No web-bundle source changed since the last measurement, so no new
load/runtime cost was introduced. Every clearly-safe win has been taken in
prior passes; remaining levers are board-tracked above or design tradeoffs.

## Disposition: done

Early-exit `done`: no web-bundle source diff since FLI-278, all prior findings
open and board-tracked, tree green (137/137 tests, 0 lint errors). The
recurring null result remains driven by the loop firing regardless of source
diff — **FLI-282** (still open) is the standing fix for that and is the only
thing that will stop this pass from re-deriving the same conclusion next cycle.
