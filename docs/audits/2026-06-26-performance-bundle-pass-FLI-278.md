# Performance & bundle-size pass — 2026-06-26 (FLI-278)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). Seventh perf pass, following FLI-198, AIR-204, FLI-219,
FLI-239, FLI-253, FLI-266.

## Workspace was stale — caught and corrected this pass

The local `main` had **diverged**: 4 prior-pass findings docs (FLI-239, FLI-253,
FLI-266, and the first draft of this one) were committed locally but **never
pushed**, while `origin/main` carried **7 unpushed-to-here commits** with real
source changes. The earlier passes' "tree byte-identical / rebuild skipped"
conclusion was an artifact of a never-updated workspace, not the shipped tree.

Action taken: rebased local main onto `origin/main` (clean, no conflicts), then
ran a **full fresh production build** against the actually-current source —
exactly the case where re-measuring is justified rather than churn.

Real source changes since the last *true* measurement (origin commits
`daec39e..7d8a1f9`):

- `src/app/app/page.tsx` (+8): new `topicFilterKey()` helper — case-insensitive
  feed-filter matching (`fix(feed)`, 90973cc).
- `packages/agent/src/{chat,runner,server}.ts`: loopback-companion fixes
  (atomic transcript writes, malformed-entry rejection) — **not in the web
  bundle**; covered by the agent test suite.
- `package.json` / `pnpm-lock.yaml`: dev-tooling security overrides
  (js-yaml, esbuild, @babel/core) — **devDependencies only**, no runtime bundle
  impact.

## Fresh build measurement (this is current, not stale)

`rm -rf .next out && pnpm install --frozen-lockfile && pnpm build` — green,
every route `○ Static`:

- `out/` total: **2.7 MB**.
- Largest JS chunk: **227 KB** raw; react-markdown graph still a single shared
  **112 KB** lazy chunk (AIR-186 split off the feed initial JS intact).
- Fonts: **22 woff2 / 554 KB** referenced (largest on-wire asset class;
  `unicode-range` subsetting lowers real cost).
- Assets: no oversized files (`og.png` 120 KB, icons ≤ 17 KB).
- Lint: **0 errors**, 27 pre-existing `<img>`/`no-img-element` warnings (moot
  under static export, where next/image optimization is disabled).
- Tests: **134/134** pass (up from 129 — merged commits added coverage).

The new `topicFilterKey(activeFilter)` is recomputed per article inside the
filter callback, but a brief holds only a handful of articles and this runs
once per render — immeasurable; not worth a change or an issue. Bundle numbers
are flat versus the prior real baseline: the genuine source delta did not move
load/runtime cost.

## All prior findings are board-tracked and open (verified, NOT re-filed)

| Finding | Issue | Status |
| --- | --- | --- |
| Companion port-sweep sequential waterfall (~7.5 s) | **FLI-188** | backlog |
| `ChatMarkdown` re-parses every typewriter beat | **FLI-187** | backlog |
| Code-split react-markdown out of remaining initial route JS | **FLI-189** | backlog |
| Dedupe companion probes on `/app` mount (in-flight token cache) | **FLI-212** | backlog |
| Stabilize two render-path values on `/app` | **FLI-213** | backlog |
| Trim 554 KB / 4-family font payload (design decision) | **FLI-233** | backlog |

AIR-204 probe-coalescing and AIR-186 feed markdown-split wins remain in source —
no silent regression.

## New untracked needle-movers

**None.** Every clearly-safe win has been taken in prior passes; remaining
levers are board-tracked above or design tradeoffs (font family count → FLI-233).

## Disposition: done

No clearly-safe untracked code change exists this cycle.

**Process fix filed (the real value this pass).** Two root causes of recurring
waste: (1) the workspace went 4 passes without pushing, so docs piled up
locally and each pass re-measured a frozen tree; (2) the loop fires every cycle
regardless of source diff. Filed **FLI-282** to gate the perf pass on a source
diff since the last `docs/audits/*performance*` entry (or early-exit `done` when
the tree is unchanged), so the loop stops re-deriving null results. This pass
also pushes the backlog of unpushed audit docs so the divergence is cleared.
