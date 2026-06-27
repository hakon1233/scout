# Architecture & Tech-Debt Review — 2026-06-27 (CAR-257)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes (parent CAR-250) and are left to them.

**Baseline & green gate:** `tsc --noEmit` clean; `pnpm test` **143/143** pass
(hermetic/offline `@scout/agent` suite — up from 142 because `8b331d8` added a
coverage test). No source code changed this pass — only this findings doc and
one filed fix-issue.

## Overall read

This is the **~15th** architecture pass on the `@scout/agent` companion ↔
Next.js web split. The standing structural debt is comprehensively tracked by a
well-shaped open backlog (see table below); prior passes (CAR-211 / CAR-225 /
CAR-239, AIR-432 / AIR-450) have already filed or fixed the genuine seams and
landed the small silent-error-swallow fixes.

This pass scoped itself to **what actually changed since the AIR-450 pass**
(`b06399f`), since re-scanning the unchanged tree a 15th time adds nothing.
Two commits landed new code:

- **`0f61065` (CAR-248)** — extracted ~211 lines of pure state-transition
  helpers out of `useProfileWorkbench` into
  `src/components/profile/useProfileWorkbench.helpers.ts`.
- **`8b331d8`** — `coverage.ts` now treats image-only sections as empty for
  citation purposes (+ a test).

Both are clean. The CAR-248 helpers are well-documented, side-effect-free, and
correctly separated from the hook (the file even documents the invariant: "if a
helper needs `window`, a timer, or a ref, it belongs in the hook, not here").
No new tangling, leaky abstraction, or duplicated logic was introduced.

## Fixed this pass (small, reversible)

None. The changed surface is clean; there was no genuinely net-new,
clearly-safe in-pass code edit to make. Honesty over activity — a forced edit on
a healthy file is net negative.

## Filed this pass (small, reversible, net-new)

### N1 — No web-side unit harness for the now-expanded pure `src/lib` / profile helpers → filed as **CAR-259**

- **Gap:** `pnpm test` runs only the hermetic `@scout/agent` suite
  (`packages/agent`, 143 tests). The web app has a Playwright **e2e** harness
  (`test:e2e`) but **no unit harness** — `git ls-files 'src/**/*.test.*'` is
  empty and there is no `vitest.config.*`. CAR-248 just extracted ~211 lines of
  pure, branch-heavy, correctness-critical state math into
  `useProfileWorkbench.helpers.ts` **explicitly to make it "independently
  importable/testable"**, yet its own commit message notes it could only be
  verified via typecheck + lint "because no frontend test seam exists yet." That
  is the precise moment to add the seam — the testable code now exists and is
  growing untested.
- **Highest-risk untested helpers:**
  - `useProfileWorkbench.helpers.ts#applyInterestChange` / `applyDocBodyChange`
    / `applyDocMetaChange` — apply a chat change to the interest list and doc
    stores; a key-matching drift silently mis-targets or drops an edit.
  - `useProfileWorkbench.helpers.ts#buildDocCards` / `mergeInterests` —
    projection + companion/local reconciliation.
  - `src/lib/interest-docs.ts#interestKey` — the key the above all match on.
  - `src/lib/errors.ts#classifyError` — drives every error-UI branch.
- **Why net-new in the CAR tracker, not a re-file:** the sibling AIR pass
  (AIR-450 N1) filed this gap in the **AIR** project's tracker only. No open
  **CAR** issue tracks a web-side unit harness; several CAR fix-issues
  (e.g. CAR-247) even say "add a unit/component test *if the harness already
  covers it*" — i.e. they assume a harness that does not exist.
- **Why not landed in-pass:** adding a `vitest` runner + config + wiring to the
  Next app is larger than a clearly-safe in-pass edit, and rushing a harness
  risks CI churn. Filed as a tracer-bullet: minimal `vitest` config + unit tests
  for the 4–6 highest-risk pure helpers first, expandable later.

## Already tracked — confirmed open, NOT re-filed

| Issue | Item |
|---|---|
| CAR-145 | Dedup request-body parsing + `ChatDeps` in agent `server.ts` |
| CAR-146 | Server-side observability for unhandled & fire-and-forget errors |
| CAR-147 | Extract shared browser hooks (SSR-guard + AbortController/cancellation) |
| CAR-244 | Extract shared companion persistence helper out of `state.ts` (in progress) |
| CAR-180 / CAR-181 | Raw-error-string leak to UI; in-app `error.tsx` boundary under `/app/*` |
| CAR-159 | `<noscript>` fallback for JS-off / bundle-load failure |
| CAR-68 / CAR-69 | (game) error boundary around `nextMonth()`; extract a leaf out of the `game.js` monolith |

## Verification

- No paid API / scrape was run (no Apify integration exists; scraping is
  delegated to the `claude` CLI's WebSearch/WebFetch, not reachable here).
- No secrets read or exfiltrated.
- Open CAR backlog (`todo` / `backlog` / `in_progress`) read via the Paperclip
  issue API before deciding what was already tracked and what to file.
- `pnpm test` 143/143, `tsc --noEmit` clean. No source changed — only this doc.

## Method

CAM tools (`read_inheritance_context` / `append_work_log_entry`) were **not
registered** this run (ToolSearch returned no matches); reconstructed prior
context from `docs/air-450-architecture-findings.md`,
`docs/audits/2026-06-26-architecture-techdebt-pass-CAR-239.md`, the git log
since `b06399f`, and the live open-issue backlog. Work-log written via the
documented comment fallback on CAR-257.
