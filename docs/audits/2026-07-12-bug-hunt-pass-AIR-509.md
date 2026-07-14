# Bug hunt & fix pass — 2026-07-12 (AIR-509)

Recurring Quality-Loop pass (Engineer slice of AIR-509). Scope: real, provable
bugs, fixed small + reversible, red-before-green. Sibling passes this cycle
already fixed the profile confirm-Undo (AIR-611), likes-persist (AIR-646), theme
color-scheme (AIR-156), and the e2e stub-claude crash (AIR-642), so this pass read
the not-recently-audited surface (agent runner/research/chat/coverage/weekly/state,
the `/v0` HTTP layer, and the client companion) plus the most-recently-churned
profile helpers. Read work was fanned out across three parallel reviewers
(agent date/scheduling/persistence, `/v0` HTTP + skills, and web lib/components),
each restricted to provable-with-a-repro findings.

## Fixed

1. **False "Today's brief failed" banner after a scheduled fail then an on-demand success** (HIGH) — FIXED.
   `src/lib/companion.ts` `assessRunFailure()`. The banner fired on
   `scheduleStatus === "failed"` without checking whether a newer success exists.
   `schedule.last_run_status` is written **only** by scheduled runs
   (`runner.ts:480`, `source === "scheduled"`), so an on-demand "Run now" success
   writes a fresh ready `last_brief` but leaves a stale `failed` schedule flag.
   Sequence: 07:00 scheduled fire fails → `scheduleStatus="failed"`; 09:00 "Run
   now" succeeds → `last_brief` ready, schedule flag untouched; on reload
   `assessRunFailure` matches the first branch and renders *"Today's brief failed
   — <7am reason>. Showing your last good brief from 09:00"* — self-contradictory
   (the "last good" time is *after* the claimed failure) over a perfectly fresh
   09:00 brief, and it persists across every reload until the next scheduled fire.
   **Fix:** suppress the failed banner when a successful brief is newer than the
   failure's timestamp (`supersededByNewerSuccess`). The failed-`last_brief` path
   is unaffected — it is the most recent run of any kind, so its `lastSuccessAt`
   (from ready history) is always older and never supersedes it. Three
   red-before-green tests added to `companion.test.ts` (stale→suppressed;
   genuine scheduled failure→still flags; failed on-demand slot→still flags).
   (Found by the web-lib reviewer; verified against `runner.ts` + `fetchRunFailure`.)

2. **Unconfirmed rewrite proposal falsely locked to "Applied" on reload** (MEDIUM) — FIXED.
   `src/components/profile/useProfileWorkbench.helpers.ts` `transcriptMessages()`.
   The reload projection marked a `pending_rewrite` card `rewriteResolved:"applied"`
   whenever the interest had **any** `op:"update"` change in the transcript
   (`consumedRewriteIds` keyed on `interestId` alone). But `op:"update"` is
   *overloaded* — emitted by both a confirm-rewrite (`confirmRewriteTurn` echoes
   the stored doc as an `update`) **and** an ordinary incremental refine. So a user
   who refined an interest incrementally and then asked for a still-pending
   from-scratch rewrite saw, on reload, the rewrite card locked "Applied" — the
   [Apply] button gone and the UI claiming a rewrite that never ran (the doc still
   held the old content). The delete side is immune (`op:"delete"` changes only
   ever come from `confirmDeleteTurn`; models gate deletes) — the asymmetry that
   hid the bug. **Fix:** key consumed rewrites on `interestId + doc` (`rewriteSig`),
   matching the confirm's verbatim doc echo; a normal incremental update carries a
   different doc and no longer over-matches. Red-before-green regression added.

   Impl note: the `rewriteSig` separator is a NUL char written as the ASCII escape
   `backslash-u-0000` (not a literal byte) so the file stays pure text and git
   diffs it normally.

## Reported — filed as small follow-up fix-issues (not fixed this pass)

3. **BriefHistory "Load older" pager can append stale briefs / corrupt its offset** (MEDIUM-LOW race).
   `src/components/BriefHistory.tsx` `loadMore()` has no abort/generation guard: if
   `currentBriefId` changes while a "Load older" fetch (from offset > 1) is in
   flight, the reset effect clears `seenIds`/`offset` and the stale in-flight fetch
   then resolves against the emptied state, appending higher-offset briefs and
   overwriting `offset` with a stale value → duplicated/out-of-order editions and a
   skipped page. Fix: capture a generation id / `AbortController` in `loadMore`.

4. **`HEAD` unsupported on `/healthz` and GET-only `/v0` routes** (LOW).
   `packages/agent/src/server.ts` (healthz gate hard-checks `req.method === "GET"`);
   `V0_ROUTE_METHODS` in `routes/index.ts` derives `["GET","OPTIONS"]` with no HEAD.
   `HEAD /healthz` -> 404 and `HEAD /v0/version` -> 405 while GET works — though the
   static-file branch already handles `GET || HEAD`, so HEAD support is intended.
   An uptime monitor issuing the common default `HEAD /healthz` concludes the
   companion is down. RFC 7231 requires HEAD wherever GET is served.

5. **Malformed `time_of_day` leaves a phantom `next_run_at`** (LOW; not API-reachable).
   `packages/agent/src/scheduler.ts` `reschedule()`: a hand-edited/legacy
   `state.json` with `time_of_day:"99:99"` makes `nextFireAt` return null, hitting
   the `if (!next) return;` early-out **before** clearing `next_run_at` — so
   `GET /v0/schedule` reports a "next fire" that never happens while no timer is
   armed. The disabled branch clears the stale value; the malformed branch should
   too. Only reachable via a corrupt/hand-edited state file (`PUT /v0/schedule`
   validates), hence low.

## Verification

- `tsc --noEmit`: 0 errors. `eslint` (changed files): 0 errors.
- Web unit suite (`test:web`, direct `tsx`): 46/46 (was 42; +4 new regressions).
- Agent suite (`@scout/agent`, direct `tsx`): 159/159 (untouched — both fixes are
  client-only, in `src/`).
- Ran via direct `node_modules/.bin/*` binaries throughout: pnpm 11.9 still
  silently rewrites `pnpm-lock.yaml` (drops the postcss override) on any bare
  `pnpm <cmd>` in this checkout — a hazard every prior pass noted.

## Reviewed, found correct (not filed)

Read closely with no provable defect: `runner.ts` (single-flight + stale-pending
reclaim), `research.ts` / `chat.ts` (spawn/timeout/abort/StringDecoder),
`coverage.ts` (freshness cutoff UTC-consistent + off-by-one-free; newest-first
sort), `weekly.ts` (7-day window + canonical-url dedupe), `state.ts`
(migrate/reconcile/corrupt-recovery), `docs.ts`, `persistence.atomicWriteFile`
(crash/race-safe), `http-util.ts` (`parseJsonBody` null->400 fix present),
`routes/briefs.ts` (pagination clamp), path-traversal in `static.ts`, and the
client `companion.ts` remainder (poll-dedup, `resolveLastSuccessBrief`). The
`@scout/agent` HTTP layer was independently fuzzed (~50 edge-case requests): zero
500s.
