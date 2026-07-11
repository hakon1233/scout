# Bug hunt & fix pass - 2026-06-26 (AIR-413)

Recurring Quality-Loop pass (Engineer). Scope: real bugs only - edge cases,
incorrect calculations, broken states, and regressions found by reading the code
and reasoning about behavior. Security, performance, design, docs, architecture,
and product-gap work belong to sibling lanes under AIR-410.

Hard guardrail honored: no paid Apify scrape was run. This pass used only local
code reading, local tests, and the Paperclip issue API.

## Result

No new small, clearly-correct behavior bug was found that should be fixed
directly in this pass, and no larger untracked bug was found that warranted a
new fix-issue.

## Surfaces checked

- Agent state and interest preservation:
  `packages/agent/src/state.ts`, `packages/agent/src/server.ts`, and the
  PER-240 wipe-guard tests in `packages/agent/test/contract.test.ts`.
- Chat persistence and destructive confirmation paths:
  `packages/agent/src/chat.ts` and `packages/agent/test/chat.test.ts`.
- Research/run assembly paths:
  `packages/agent/src/research.ts`, `packages/agent/src/runner.ts`,
  `packages/agent/src/coverage.ts`, and `packages/agent/test/coverage.test.ts`.
- Weekly digest extraction, story freshness, and URL dedupe:
  `packages/agent/src/weekly.ts` and `packages/agent/test/weekly.test.ts`.

## Investigated and rejected

- `reconcileInterests` initially looked like it could detach an intent doc when
  a topic is resent with harmless whitespace. The API boundary trims and dedupes
  topics in `parseInterestsPayload` before reconciliation, and chat updates do
  not use this topic-only path, so this is not an observable bug.
- Retry and selected-run subsets were checked for duplicate-topic spend or wrong
  coverage. `server.ts` maps wire topics through the current canonical topic
  list, and `runner.ts` dedupes before deciding whether a selection is a strict
  subset, so this case is already covered.
- Weekly digest extraction was checked for stale-story leakage, duplicate URL
  variants, and raw weekly re-ingestion. Existing code filters daily-only ready
  briefs, applies the seven-day story date window, and canonicalizes URLs before
  dedupe; the current weekly tests pin those behaviors.
- Assembly freshness and coverage were checked around the 30-day boundary,
  undated stories, evergreen opt-ins, missing sections, and out-of-order story
  bullets. The existing coverage tests pin all of those edge cases.

## Verification

- `pnpm test` - pass, 142/142.

## Disposition

No source changes and no new issues. Closing AIR-413 done with this audit note as
the durable result of the pass.
