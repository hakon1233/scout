# Bug hunt & fix pass — 2026-06-26 (FLI-341)

Recurring Quality-Loop pass (Engineer). Scope is **real bugs only** — edge cases,
incorrect calculations, broken states, regressions found by reading the code and
reasoning about behavior. Security, perf, design, docs, architecture and product
gaps belong to the sibling lanes in this same Quality Pass (FLI-338 parent) and
are deliberately left to them.

**Baseline & green gate (after fixes):** typecheck clean, `pnpm test`
**137/137** pass (exit 0), `eslint` **0 errors** (27 pre-existing warnings, all
the tracked `@next/next/no-img-element` LCP perf-lane nits). Prettier on the two
touched files is unchanged relative to baseline — `chat.ts` already failed the
repo-wide `format:check` before this pass (the repo has 85 unformatted files; a
mass reformat is out of scope for a bug-hunt lane), and `page.tsx` is clean.

## Method

Read the core logic by hand (`likes.ts`, `run-history.ts`, `chat-diff.ts`,
`storage.ts`, `interest-docs.ts`, `companion.ts`, `format-date.ts`,
`coverage.ts`, `weekly.ts`, `scheduler.ts`, `state.ts`, `runner.ts`,
`FeedView.tsx`), then fanned out three focused bug-hunt reviewers across the
remaining surface: the agent backend (`server.ts`, `chat.ts`, `research.ts`,
`docs.ts`, `service.ts`), the React component/page layer
(`useProfileWorkbench.ts`, `ScheduleSettings.tsx`, `BriefHistory.tsx`,
`AgentProgressPanel.tsx`, `src/app/app/**/page.tsx`, `src/lib/chat*.ts`), and the
skills/static/markdown surface (`search-skills.ts`, `assembly-skills.ts`,
`static.ts`, `weekly.ts`, `coverage.ts`, `build-info.ts`, `errors.ts`).

The codebase remains heavily hardened by prior passes — most edge cases are
already handled and commented. Two genuine defects surfaced; both were small,
clearly-correct, and reversible, so both were **fixed directly**.

## Fixed directly this pass (small, clearly-correct, build/lint/test green)

1. **`confirmDeleteTurn` reverted a concurrent interest-set change (TOCTOU).**
   (`packages/agent/src/chat.ts`)
   The confirm-gated delete loaded state once for the proposal gate, spliced the
   deletion out of *that* snapshot's `interests`, then reloaded `fresh` state and
   persisted `{ ...fresh, interests }` — but `interests` was derived from the
   **stale** first load. Any interest the user added (via `PUT /v0/interests`) in
   the window between the two `loadState` calls would be silently dropped on the
   confirmed delete. `confirmRewriteTurn` doesn't touch `interests`, so it was
   unaffected; the bug was specific to delete.
   **Fix:** reload `fresh` first, then run `applyConfirmedDelete` against
   `fresh.interests` and persist that. Side benefit: a double-confirm now finds
   the interest already gone in `fresh` and correctly 404s instead of re-deleting.
   Existing confirm-delete tests (happy path + both 404 paths) stay green.

2. **Dead "Cancel" control during a weekly-brief run (PER-139 anti-pattern).**
   (`src/app/app/page.tsx`, `src/components/AgentProgressPanel.tsx`)
   A daily/retry/selected run threads an `AbortController` through
   `refreshBriefViaCompanion`, so the progress panel's Cancel button aborts it.
   The weekly digest path (`runWeekly` → `generateWeeklyBrief`) assembles
   synchronously with **no** signal and never set `abortRef.current`, yet the
   panel still rendered an enabled Cancel button (its `canCancel` defaults to
   `true`). Clicking it was a no-op — exactly the dead-control pattern the
   codebase otherwise avoids.
   **Fix:** added a `cancelable` state (true for daily/retry/selected runs, false
   for weekly) and forwarded it as `canCancel` to `AgentProgressPanel`, so the
   button is hidden for the weekly run rather than presented as a lie. Wiring
   real cancellation into `generateWeeklyBrief` would need a signal parameter
   threaded through the companion client — larger and not warranted, since the
   weekly assembly is fast and local.

## Investigated and rejected / already-correct

- `runChatTurn` has a structurally similar single-load-then-reload pattern for
  `interests`, but it is the documented single-flight chat path (guarded by
  `chatInFlight`) and a change there touches the broader concurrency model;
  left as-is (the cleaner, trivially-reappliable instance was the delete path,
  which is what got fixed).
- `weekly.ts` dedup/sort ordering, `coverage.ts` freshness boundary
  (`>= cutoffDate`, inclusive 30-day edge), `sortSectionStoriesNewestFirst`
  stability, the non-global `LINK_RE`/`STORY_DATE_RE` (no `lastIndex` footgun),
  `static.ts` path-traversal guard, `errors.ts` `parseRetryAfter` empty/NaN
  guards, `run-history.ts` NaN-date sort, `BriefHistory.tsx` pagination
  (offset-from-1, dedup, reset-on-brief-change), `useProfileWorkbench.ts` stop /
  typewriter lifecycle, `format-date.ts` timezone handling, `likes.ts` /
  `storage.ts` quota-safe writes — all read as correct and are well covered by
  tests/comments. No change.
- `src/components/RunScopeSelector.tsx` is dead code (run-scope selector removed
  per PER-219 AC5) and contains a latent `Set.size === array.length` comparison
  that would misbehave with duplicate topics — but it is unobservable while the
  component is unmounted. Not fixed (would be re-introduction work, not a bug
  fix); noted here for whoever revives it.

No new fix-issue filed — nothing larger than the two one-/few-liners fixed above
that isn't already tracked.
