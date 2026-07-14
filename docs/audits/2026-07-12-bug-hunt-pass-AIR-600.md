# Bug hunt & fix pass — 2026-07-12 (AIR-600)

Recurring Quality-Loop pass (Engineer slice of AIR-600). Scope: real, provable
bugs, fixed small + reversible, red-before-green. A sibling run (AIR-612) already
fixed the likes-persist bug (AIR-646) this cycle, so this pass targeted the chat
action-card state machine and the e2e harness instead.

## Fixed

1. **Confirmed rewrite/delete minted no live Undo** (AIR-611, high) — FIXED.
   `useProfileWorkbench.ts`: pressing [Apply] on a confirm-gated rewrite (or
   [Delete] on a confirm-gated delete) wrote the change durably but surfaced no
   Undo — asymmetric with create, which gets a live Undo. `confirmRewrite()` /
   `confirmDelete()` fed the confirm turn's `changes` through
   `applyChanges()`/`flashRemove()` but never attached `changes`/`prev` to a
   message, so `ChatDock` never rendered a `ChatActionCard` and the app's only
   Undo button never got a chance to exist. A reload already showed the Undo (the
   confirm turn re-projects through `transcriptMessages`), so live and reloaded
   state disagreed. Fix: new pure helper `appliedChangeMessage()` builds the
   follow-up scout action card (`changes` + a pre-change `prev` snapshot) — the
   exact shape `dispatch()` gives a live turn and a reload gives a hydrated one —
   and both confirm handlers now append it. Reuses the tested `ChatActionCard` +
   `undo` channel. Commit `974f7bb`.

2. **e2e stub `claude` crashed unconditionally** (AIR-642 root cause) — FIXED.
   `e2e/fixtures/stub-claude.mjs`: the chat branch added in #25 made `emit()`
   branch on `stdin.includes(CHAT_MARKER)`, but the `data` handler still drained
   the prompt into a no-op — no `stdin` accumulator was ever declared. So `stdin`
   was undefined and `emit()` threw `ReferenceError: stdin is not defined` the
   moment stdin closed, for BOTH the brief and chat paths. Every e2e spec that
   shells out to `claude` was red (locally it failed; in CI the AIR-642 guards
   skip it) — the suite ran zero real coverage. Fix: accumulate the piped prompt
   into a module-scoped `stdin` string. Local e2e went from all-crashing to
   65/66. Commit `9f47ad6`.

## Reported (not fixed — separate area / out of scope)

3. **`e2e/liked-live-flow.spec.ts` fails deterministically** (MEDIUM) — REPORTED.
   With the stub fixed, this spec fails in isolation: after liking a freshly
   generated story, `heading "Alignment update" (level 3)` never appears in the
   Liked feed (`liked-live-flow.spec.ts:119`). It has been dark since #25 broke
   the stub, so this is either pre-existing or a regression from the AIR-646
   likes-cache change (`51022f7`, done) that this run's tree now includes — the
   likes owner should determine which. Its AIR-642 CI guard was left in place so
   CI is not reddened. Tracked as a new fix-issue.

## Verification

- `tsc --noEmit`: 0 errors. `eslint` (changed files): 0 errors.
- Web unit suite (`test:web`, direct tsx): 39/39, incl. 3 new
  `appliedChangeMessage` tests (RED→GREEN).
- Root `test/*.test.mjs`: pass. Agent suite exercised via the packed e2e tarball.
- Full local e2e (`SCOUT_E2E_PORT` to dodge the port-47821 squatter): 65/66 —
  the only failure is finding #3 above; `chat-rewrite-undo` (AIR-611) went
  RED→GREEN, `chat-actions` + `chat-undo` green.

## Notes for the next pass

- AIR-642 is only partially closed: the crash is fixed, but the 8 `test.skip(!!CI)`
  guards remain. Lifting them (restoring CI e2e coverage) should be a focused
  follow-up that (a) fixes `liked-live-flow` and (b) validates the run in CI.
- pnpm 11.9 still silently rewrites `pnpm-lock.yaml` (drops the postcss override)
  on any bare `pnpm <cmd>`; used direct `node_modules/.bin/*` binaries throughout.
