# Bug hunt & fix pass — 2026-07-14 (AIR-743)

Recurring Quality-Loop pass, Engineer slice. Scope: read the code, reason about
behavior, land the smallest clearly-correct fix with a red-before-green
regression guard, and file (not fix) anything larger or riskier. Security,
design, docs, performance, product gaps, and architecture are covered by sibling
lanes in this same pass.

Method: a full manual read of the core (all of `src/lib/*`, `src/components/**`,
`src/app/app/**`, and the `@scout/agent` engine — runner/research/chat/coverage/
scheduler/state/weekly/persistence/docs + the `/v0` routes), plus three
subsystem audit agents (HTTP routes, agent core logic, React components) whose
candidate findings I verified against the code before acting.

## Fixed

1. **Starting a run while a single-story detail was open blanked the whole feed
   and hid all run progress for the entire run.** (`src/app/app/page.tsx`)

   The single-story collapse (PER-222/223) hides all page chrome behind
   `storyOpen = todayStoryOpen || historyStoryOpen`. Starting a run unmounts the
   open-story feed — the feed block swaps to `BriefSkeleton` when
   `showSkeleton` (`progress.stage === "synthesizing"`) is true — but the
   unmounting `FeedView` never emits `onDetailOpenChange(false)` (its effect has
   no unmount cleanup), so `todayStoryOpen`/`historyStoryOpen` stayed stuck
   `true`. The run chrome (the `AgentProgressPanel` + `BriefSkeleton`), gated on
   `{!storyOpen && …}`, was therefore suppressed at the *same time* the feed
   unmounted. Net: press "Run now" (profile menu, always rendered) while reading
   a story → a blank content area with zero progress feedback for the whole
   multi-minute run. It self-healed only when the run finished and a fresh
   `BriefLayout` mounted.

   **Fix:** reset `setTodayStoryOpen(false)` / `setHistoryStoryOpen(false)` at
   run start in both run entry points (`generate()` and `runWeekly()`), right
   where the other per-run state resets live. A run is closing the open story
   (its feed is about to unmount), so showing run progress instead is the
   intended behavior. Two lines per call site; no other consumer of the
   story-open flags is affected (during a run the feed block renders neither
   `BriefLayout` nor `BriefHistory`).

   **Regression:** `e2e/run-while-story-open.spec.ts` — opens a story, fires
   "Run now" (the one `POST /v0/interests` is intercepted/delayed so no synthesis
   runs — no `claude`/stub spawn, no scrape), and asserts the progress panel
   renders and single-story mode has exited. Proven red-before-green: with the
   reset reverted the progress-panel assertion fails; with it, green.

## Verification

- Baseline before the change: `pnpm test` green (root 2, `@scout/agent` 162,
  web 59), `pnpm typecheck` + `pnpm lint` clean.
- New spec green with the fix (port 47955); **red** with the fix reverted
  (port 47956) — the `Agent progress` / "Companion is fetching & synthesizing"
  assertion fails, proving the guard bites.
- New spec + the 3 existing `feed-story-detail` single-story tests: 4/4 green in
  one run (port 47957) — the fix doesn't regress the collapse behavior.
- After the change: `pnpm typecheck` (0), `pnpm lint` (0), `pnpm test` green
  (root 2, agent 162, web 59).

## Filed, not fixed

- **Cross-domain state clobber between a brief run and a chat turn (AIR-752).**
  `runInFlight` (runner.ts) and `chatInFlight` (chat.ts) are *independent*
  single-flight guards, so a brief run and a chat turn / confirm-delete /
  confirm-rewrite genuinely run concurrently. Both do reload-modify-`saveState`
  over the *whole* `State` (each spreading `...fresh`, including the fields the
  other domain owns), last-writer-wins. A confirmed delete that lands while a
  scheduled/on-demand run is doing its final save can be reverted (interest
  resurrected, confirm turn lost) — and symmetrically a chat turn can clobber a
  freshly-landed `last_brief`/`briefs`. Real but narrow (the clobber window is
  each writer's reload→save gap); the correct fix (a shared write lock / single
  serialized save queue) is a design change, so it's filed rather than forced
  into this small pass.

## Reviewed, still low / not re-filed

Surfaced by the audit agents, confirmed real but low-severity and/or already
documented in prior passes — recorded here so a future pass doesn't re-derive
them from scratch:

- `GET /v0/interests` returns 500 for the whole list if a single `<id>.md` doc
  is unreadable for a non-ENOENT reason (the per-entry `Promise.all` rejects).
  Degrading to `hasDoc:false/doc:null` per entry would be the fix. (AIR-181 #4.)
- `POST /v0/chat/stop` with a non-string `turn_id` narrows to `undefined` →
  stops whatever turn is in flight, defeating the stale-Stop id match. Client
  always sends a UUID, so prod-unreachable. (AIR-181.)
- Focused-retry merge base isn't `kind`-guarded — a hand-crafted retry against a
  weekly `last_brief` merges daily sections into a weekly digest. Not
  scheduler/FE reachable (weekly briefs carry no coverage/`topics`). (AIR-181.)
- Malformed `time_of_day` (only reachable via a hand-edited `state.json`; PUT
  validates) leaves a phantom `schedule.next_run_at` because `reschedule()`
  early-returns before clearing it. (AIR-509 #5.)
- `FeedImage` never resets its `failed` state when `src` changes — latent only;
  every mounted instance has a stable `src` per React key today.
- `HEAD /healthz` / GET-only `/v0` routes return 404/405 (uptime monitors that
  default to HEAD read the companion as down). (AIR-509 #4.)
- Multi-delete / multi-rewrite in one chat turn surfaces only the first proposal
  (`pendingDeletes[0]` / `pendingRewrites[0]`); the rest are silently dropped —
  already tracked (AIR-691, e2e coverage landed).

## Notes

- Left unrelated untracked work alone (`.gstack/`, `docs/audits/air-655-shots/`).
- HARD GUARDRAIL honored: no paid Apify scrape and no real `claude` run — the
  new e2e intercepts the one `POST /v0/interests`, and the e2e companion already
  stubs `claude` via `SCOUT_CLAUDE_BIN`.
