# Bug hunt & fix pass — 2026-06-26 (AIR-398)

Recurring Quality-Loop pass (Engineer). Scope: real bugs only — edge cases,
incorrect calculations, broken states, and regressions found by reading the code
and reasoning about behavior. Security, performance, design, docs, architecture,
and product-gap work belong to the sibling lanes under AIR-395.

Hard guardrail honored: no paid Apify scrape was run. This pass used only local
code reading, local tests, and the Paperclip issue API.

## Result

No new small, clearly-correct bug was found that should be fixed directly in this
pass, and no larger untracked bug was found that warranted a new fix-issue.

This codebase has had several quality passes land in the same area today. The
fresh review deliberately avoided re-fixing or re-filing items already covered by
FLI-341 and the architecture/security/performance audit docs.

## Surfaces checked

- Client companion/chat bridge: `src/lib/companion.ts`, `src/lib/chat.ts`,
  `src/lib/run-history.ts`, `src/lib/interest-docs.ts`.
- Main app run flows and history/feed UI:
  `src/app/app/page.tsx`, `src/components/BriefHistory.tsx`,
  `src/components/ScheduleSettings.tsx`, `src/components/FeedView.tsx`,
  `src/app/app/connect/page.tsx`, `src/app/app/profile/interest/page.tsx`,
  `src/app/app/liked/page.tsx`.
- Agent API pagination and contracts:
  `packages/agent/src/server.ts`, `packages/agent/src/state.ts`,
  `packages/agent/test/contract.test.ts`.
- Local storage / likes utilities:
  `src/lib/storage.ts`, `src/lib/likes.ts`, `src/lib/errors.ts`,
  `src/components/ui/Button.tsx`.

## Investigated and rejected

- `BriefHistory` pagination looked suspicious because `loadMore` is memoized
  while paging state changes. On inspection, the current cursor is read through
  `offsetRef.current`, and the button primitive disables itself while `loading`,
  so there is no stale-cursor or double-click duplicate-page bug to fix.
- `storage.ts` save/clear SSR guard asymmetry was already recorded and rejected
  by prior architecture passes. The shared `safeSetItem` now guards writes, and
  the remaining clear/save call sites are client-only.
- `eslint --max-warnings=0` reports the known 27-warning baseline: unused args in
  test/stub helpers plus the tracked `@next/next/no-img-element` warnings. These
  are not behavior bugs and were already called out by prior quality docs.
- The existing FLI-341 bug-hunt doc already covered and fixed the two concrete
  defects in nearby code (`confirmDeleteTurn` TOCTOU and weekly-run dead Cancel).
  This pass did not re-open those areas except to verify they should not be
  duplicated.

## Verification

- `pnpm test` — pass, 142/142.
- `pnpm exec tsc --noEmit --pretty false` — pass.
- `pnpm exec eslint . --max-warnings=0` — fails only because the repo still has
  the known 27 warnings baseline, with 0 errors.

## Disposition

No source changes and no new issues. Closing AIR-398 done with this audit note as
the durable result of the pass.
