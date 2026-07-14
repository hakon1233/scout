# Bug hunt & fix pass - 2026-07-12 (AIR-612)

Recurring Quality-Loop pass (Engineer slice of AIR-612). Scope: small, provable
correctness bugs found by code reading + hermetic unit tests, fixed red-before-green.

## Result

Fixed one graceful-degradation bug in the device-local likes store.

1. **Likes silently reverted when a persist was swallowed** (AIR-646).
   `src/lib/likes.ts` `write()` set the raw-string cache (`cacheRaw`) to the value
   it *intended* to persist **before** calling `safeSetItem`. When the write is
   swallowed — Safari private window, `QuotaExceededError`, disabled/partitioned
   storage — localStorage keeps the pre-toggle value, so the very next `read()`
   (fired synchronously by `notify()` through `useSyncExternalStore`) mismatches
   `raw === cacheRaw`, re-parses storage, and reverts the optimistic like. The
   heart flipped back even though `toggleLike` returned `true`, and a second tap
   re-liked instead of un-liking. This defeated the degradation contract that
   `safe-storage.ts` and `write()`'s own comment promise ("the in-memory cache
   still reflects the toggle for this session; it just won't survive a reload").

## Fix

- `src/lib/likes.ts`: after `safeSetItem`, point `cacheRaw` at what localStorage
  *actually* holds (`getLocalStorage()?.getItem(LIKES_KEY) ?? null`) rather than
  the intended value. On a successful persist that's the written value (unchanged
  behavior); on a swallowed persist it matches the live value so `read()`'s guard
  keeps the optimistic `cache` for the session.
- `src/lib/likes.test.ts` (new, wired into the `test:web` script): stubs a
  `window.localStorage` whose `setItem` throws while `getItem` keeps returning the
  pre-toggle value, and asserts the like survives (`isLiked` stays true), a happy
  persist still round-trips, and a second toggle un-likes. Red before the fix
  (2 failing), green after.

Commit `51022f7`, pushed to `main`.

## Verification

- `pnpm exec tsx --test src/lib/likes.test.ts` — reproduced the red (1 pass /
  2 fail) before the change, then green (3/3) after.
- `pnpm test` — pass (root 1, `@scout/agent` 159, web 42).
- `pnpm typecheck` — clean. `pnpm lint` — 0 errors (4 pre-existing `<img>`
  warnings, unrelated).

## Reviewed, not filed

- `src/lib/format-date.ts`, `src/lib/run-history.ts`, `src/lib/interest-docs.ts`,
  `src/lib/chat-diff.ts` — read closely; timezone/dedupe/slug logic all correct.
- `likes.ts` cross-tab **clear** edge (another tab removes `LIKES_KEY` entirely
  → `read()` could return a stale cache since `raw === cacheRaw === null`) is
  unreachable in-app: the store only ever writes JSON strings, never removes the
  key. Left as a documented non-issue, not filed.

## Note for future passes — shared-workspace collision

During this pass the shared workspace HEAD advanced (`48e31b9` → `98d8ec7`) and
foreign uncommitted edits (`useProfileWorkbench.*`, `e2e/chat-rewrite-undo.spec.ts`)
appeared mid-run — a concurrent quality-pass agent working the same checkout
(the known "colliding runs" hazard). Handled by staging only this pass's three
files (`git add <paths>`, never `git add -A`), committing, and pushing to `main`
via `HEAD:main`; the other agent's work was left untouched.
