# Bug hunt & fix pass — 2026-07-12 (AIR-509)

Recurring Quality-Loop pass (Engineer slice of AIR-509). Scope: real, provable
bugs, fixed small + reversible, red-before-green. Sibling passes this cycle
already fixed the profile confirm-Undo (AIR-611), likes-persist (AIR-646), theme
color-scheme (AIR-156), and the e2e stub-claude crash (AIR-642), so this pass read
the not-recently-audited surface (agent runner/research/chat/coverage/weekly/state,
the `/v0` HTTP layer, and the client companion) plus the *most-recently-churned*
file — `useProfileWorkbench.helpers.ts` (touched by AIR-611/600 this cycle).

## Fixed

1. **Unconfirmed rewrite proposal falsely locked to "Applied" on reload** (MEDIUM) — FIXED.
   `src/components/profile/useProfileWorkbench.helpers.ts` `transcriptMessages()`.
   The reload projection marked a `pending_rewrite` card as `rewriteResolved: "applied"`
   whenever the interest had **any** `op:"update"` change anywhere in the transcript
   (`consumedRewriteIds` keyed on `interestId` alone). But `op:"update"` is
   *overloaded*: it is emitted by both a confirm-rewrite (`confirmRewriteTurn`
   echoes the stored doc as an `update`) **and** an ordinary incremental refine.
   So a user who refined interest "AI" incrementally and *then* asked for a
   from-scratch rewrite (still pending, not confirmed) would, on reload, see the
   rewrite card locked as "Applied" — losing the [Apply] button and being told a
   full rewrite ran that never did (the doc still held the old incremental
   content). The delete side is immune (an `op:"delete"` change only ever comes
   from `confirmDeleteTurn`; models gate deletes), which is exactly the asymmetry
   that hid the bug.

   **Fix:** key consumed rewrites on `interestId + doc` (`rewriteSig`), matching
   the confirm's verbatim echo of the exact proposed doc. A normal incremental
   update carries a *different* doc, so it no longer locks the proposal. Delete
   detection is left keyed on `interestId` (correct — deletes can't over-match)
   with a comment recording the asymmetry.
   `src/components/profile/useProfileWorkbench.helpers.test.ts`: added a
   red-before-green regression (`keeps an unconfirmed rewrite actionable after an
   unrelated incremental update`). Reproduced red (`rewriteResolved === "applied"`)
   before the change, green after. The existing "later apply turn locks it" and
   "unresolved stays actionable" tests still pass (the confirm's doc matches).

   Impl note: the sig separator is a NUL char written as the ASCII escape
   `backslash-u-0000` in source (it can't appear in an `int_...` id, so pairs
   never collide) — kept as an escape, not a literal byte, so the file stays
   pure text and git diffs it normally.

## Reported (not fixed this pass)

2. **`HEAD` unsupported on `/healthz` and GET-only `/v0` routes** (LOW) — REPORTED.
   `packages/agent/src/server.ts` (healthz gate hard-checks `req.method === "GET"`;
   `V0_ROUTE_METHODS` in `routes/index.ts` derives `["GET","OPTIONS"]` with no HEAD).
   `HEAD /healthz` -> 404 and `HEAD /v0/version` -> 405, while GET works — even
   though the static-file branch already handles `GET || HEAD`, so the codebase
   intends HEAD support. Impact: an uptime monitor issuing the common default
   `HEAD /healthz` concludes the companion is down. RFC 7231 requires HEAD wherever
   GET is served. Small, reversible; filed as a follow-up fix-issue.

## Verification

- `tsc --noEmit`: 0 errors. `eslint` (changed files): 0 errors.
- Web unit suite (`test:web`, direct `tsx`): 43/43 (was 42; +1 new regression).
- Agent suite (`@scout/agent`, direct `tsx`): 159/159 (untouched by this change —
  the fix is client-only).
- Ran via direct `node_modules/.bin/*` binaries throughout: pnpm 11.9 still
  silently rewrites `pnpm-lock.yaml` (drops the postcss override) on any bare
  `pnpm <cmd>` in this checkout (a hazard every prior pass noted).

## Reviewed, found correct (not filed)

Read closely with no provable defect: `runner.ts` (single-flight + stale-pending
reclaim), `research.ts` / `chat.ts` (spawn/timeout/abort/StringDecoder),
`coverage.ts` (freshness cutoff + newest-first sort), `weekly.ts` (week window +
canonical-url dedupe), `state.ts` (migrate/reconcile/corrupt-recovery),
`docs.ts`, `http-util.ts` (`parseJsonBody` null->400 fix present), `routes/briefs.ts`
(pagination clamp), and the client `companion.ts` (poll-dedup, run-failure assess).
The `@scout/agent` HTTP layer was independently fuzzed (~50 edge-case requests):
zero 500s.
