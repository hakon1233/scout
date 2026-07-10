# AIR-388 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-06-26._

## TL;DR

The `@scout/agent` companion ↔ Next.js web split remains healthy. This is the
**eleventh+** architecture pass on this tree, and the structural debt is by now
**comprehensively tracked** by an open, well-shaped backlog — see the table
below. Two parallel review sweeps (agent engine + web↔agent contract) surfaced a
long list of candidates; on scrutiny **nearly all of them map to already-open
fix-issues**, so per the recurring-pass guardrail they are deliberately **not**
re-filed.

One genuinely net-new, clearly-safe observability gap was found and **fixed
in-pass**: a fully-silent `catch` on the per-topic research path. No new issues
filed — the only un-tracked *structural* idea (a shared web↔agent types package)
contradicts the direction a prior pass deliberately chose (AIR-272), so it is
recorded as "considered, not filed" rather than added as backlog noise.

**Baseline: `pnpm test` 141/141 green (hermetic/offline), `tsc --noEmit` clean,
`eslint` clean on touched file, `prettier --check` clean. Tree left green.**

## Fixed in this pass (small, clearly-safe, reversible)

### F1 — `runner.ts` swallowed every per-topic research failure with zero signal ✅ FIXED

- **File:** `packages/agent/src/runner.ts` (the research loop, ~L340).
- **Problem:** When one topic's `researchAndSynthesize` session throws (claude
  subprocess error, non-zero exit, empty/parse failure), the loop caught it with
  a **bare `catch {}`** — no log — recorded the section as `null`, and continued.
  Correct for resilience (one bad topic must not sink the whole brief), but it
  means a reader sees a **silent gap** in their brief and ops has **zero signal**
  about *which* topic failed or *why*. A timeout, an auth blip on one topic, and
  a genuinely empty result were all indistinguishable: silent absence.
- **Why net-new (not a re-file):** This is the *research* failure path, distinct
  from the already-tracked observability items — AIR-179 covers best-effort
  **cleanup** catches (orphan temp dirs; already implemented at runner.ts:472),
  and AIR-356's N2 is the broader **correlation-ID** effort. The research-loop
  catch was the one remaining *totally silent* catch on a user-visible path.
- **Fix:** Bind the error and `console.warn('[runner] research failed for topic
  "…":', err)` before pushing the null section. Control flow is **unchanged**
  (still degrades to a missing section and continues) — purely additive
  observability, matching the existing `console.warn` pattern at runner.ts:472.
- **Token-safety:** The OAuth token never reaches this `err` (spawn never
  forwards it — guarded by the PER-108 test), so the new log line stays
  log-safe; the contract-test token-leak guard still passes.
- **Verification:** `pnpm test` 141/141, `tsc --noEmit` clean, `eslint` +
  `prettier --check` clean on `runner.ts`.

## Considered and deliberately NOT filed

### Web↔agent type-shape duplication (ChatChange / ChatTurn / TopicCoverage)

`src/lib/chat.ts` and `src/lib/types.ts` hand-mirror types defined in
`packages/agent/src/state.ts` / `coverage.ts` (the web copies even carry
"Mirrors the agent's …" comments). A drift here compiles clean and fails at
runtime. **Not filed**, because a prior pass already weighed this and chose the
*pragmatic* mitigation — a cross-package **contract test** pinning the wire shape
(**AIR-272**, open) — over standing up a shared-types package in this two-package
monorepo. Filing "extract a shared types package" would re-litigate that
decision and risk a big-bang refactor the guardrail forbids. The contract-test
direction (AIR-272) is the right home; recorded here so the next pass doesn't
rediscover it as "untracked."

### Other agent-sweep candidates — all already tracked (see table)

The per-topic *basis-backfill* catch (runner.ts:365) is intentionally silent and
genuinely low-value (degrades to "no basis shown" for one topic; full-ISO
inputs) — left as-is. The remaining sweep findings each land on an open issue
below.

## Already tracked — confirmed open, NOT re-filed

| Issue | Item | Maps to sweep finding |
|---|---|---|
| AIR-197 | Extract route table + `withAuthedJson` from the 1,100-line `server.ts` | server.ts god-handler |
| AIR-198 | Shared `spawnClaude()` + chat per-session timeout (research/chat spawn dup) | inconsistent subprocess timeout/kill |
| AIR-195 | Chat confirm-delete/rewrite TOCTOU vs. in-flight turn (lost update) | race-prone double-`loadState` |
| AIR-196 | `readChatTranscript` corrupt-read handling | transcript parse robustness |
| AIR-177 | `/v0` 500 handler leaks `String(err)` to client | error-detail leak |
| AIR-178 | Cap chat transcript growth (last-N) / whole-file poll read | unbounded transcript |
| AIR-179 | Observability on best-effort cleanup catches | (cleanup) — F1 is the *research* sibling |
| AIR-272 | Pin web↔agent wire contract via contract test | type-shape duplication / date token |
| AIR-371 | Decompose `AppPage` god-component (useCompanionSync/useBriefRun) | web page.tsx god-component |
| AIR-375 | `POST /v0/weekly-brief` bypasses single-flight, clobbers brief slot | weekly-brief concurrency |
| AIR-377 | Dedup Connect-page brief poll loop into `refreshBriefViaCompanion` | duplicated/unbounded poll loop |
| AIR-129 | No frontend test harness over the pure web seams | (leaves web fixes unguarded) |
| AIR-356 N1/N2 | Scattered client fetch timeouts; structured-logging/correlation IDs | timeout magic numbers; observability |

## Verified non-issues (don't file)

- `os.setPriority(...)` in both spawn paths is already try/catch-wrapped — no
  crash risk.
- `state.json` corrupt→wipe is **already fixed** (AIR-356 F1, commit 9de05c2);
  `preserveCorruptState` ships with tests.
- AIR-371's dead-error-path / safety-predicate dedup just landed (commit
  6fe6381) — no residual.
- No `TODO/FIXME/HACK` markers in `packages/agent/src`.
- **No Apify integration in the repo** — web scraping is delegated to the
  `claude` CLI's WebSearch/WebFetch; the paid-scrape hard-guardrail flow is not
  reachable here. (Confirmed again this pass.)

## Bottom line

Architecture is sound; no big-bang rewrite warranted, and the structural backlog
is well-shaped and current. The needle-mover this pass was **closing the last
fully-silent catch on a user-visible path** (F1, shipped). No new issues filed —
re-filing the well-tracked backlog or re-litigating the AIR-272 contract-test
direction would be backlog noise, not signal.

## Method

`read_inheritance_context` unavailable (CAM plugin tools not registered this
run); reconstructed prior context from `docs/air-356-architecture-findings.md`,
`docs/audits/2026-06-26-architecture-techdebt-pass-AIR-300.md`, and the open
issue backlog (`paperclipListIssues`). Sized every module (`wc -l`); fanned out
two read-only review agents over the fat modules (`server.ts` 1119, `chat.ts`
907, `companion.ts` 678, `runner.ts`, `state.ts`, `research.ts`, `coverage.ts`);
cross-checked each candidate against the open backlog to separate net-new from
tracked; made the one clearly-safe fix; ran `tsc --noEmit` + `eslint` +
`prettier --check` + `pnpm test` (141/141 green).

### Environment note (non-code)

This run started with the host **root volume full** (`ENOSPC`) — Bash could not
even write its output-capture files, and `paperclipListIssues` failed to persist
results. Cleared by removing regenerable build artifacts (`.next/`, `out/`,
truncating the gitignored `tsconfig.tsbuildinfo`), which freed ~20 GiB. All
removed paths are gitignored; `git status` stayed clean. Flagging because a
recurring full-disk condition on the Mac mini host would silently break the
scheduler/agent over time — an **ops/observability** concern outside this repo's
code (no disk-space guard or alert exists), worth the host owner watching.
