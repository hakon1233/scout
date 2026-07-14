# AIR-619 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-07-11. Audited at `main` HEAD
`bc2482e` (this pass's own fix commit)._

## TL;DR

Scout's `@scout/agent` companion ↔ static Next.js web split remains structurally
sound. This is the ~15th architecture pass on a **very well-tended** codebase: the
standing structural debt is comprehensively tracked by a large, well-shaped backlog
(server.ts already decomposed, hooks/persistence/state seams already extracted).

Method: four-phase pass (map → parallel read-only audit of the three hotspot areas
[`packages/agent/src`, `src/lib`, `src/app`+`src/components`] → verify every
candidate against the tree and the open backlog → deliver). Every finding below was
re-confirmed by the CTO at `bc2482e`; subagent claims were not taken on trust.

**Landed 3 small, clearly-safe, behavior-preserving fixes directly** (commit
`bc2482e`). **Filed 3 net-new scoped issues** (AIR-625/626/627) for the larger
items. Everything else maps to an already-open issue and was **not re-filed**.

**Tree left green:** `tsc --noEmit` clean · `pnpm lint` 0 errors (29 pre-existing
`<img>` warnings) · `pnpm test` green (157 agent + 30 web + 1 root).

## Landed this pass (commit `bc2482e`)

1. **Wired the orphaned `src/lib/safe-storage.test.ts` into `test:web`.** Three
   tests existed on disk but were never in the runner (the repo-audit F15 orphan) —
   so the storage-guard degradation path had no executing coverage. Web suite
   27 → 30. Pure test-runner change; zero source risk.
2. **Removed the dead `prevBrief` storage API** (`loadPrevBrief`/`savePrevBrief`/
   `clearPrevBrief` in `src/lib/storage.ts`) — verified **zero callers** (client-side
   prevBrief rotation was removed in PER-219). Kept the `PREV_BRIEF_KEY` purge in
   `clearSettings()` for legacy-install cleanup and re-labelled the key comment.
3. **Deduped `mergeInterests`** — it was copied **verbatim** in
   `useProfileWorkbench.helpers.ts` and `app/profile/interest/page.tsx`. Hoisted to
   its single home in `lib/interest-docs.ts` (next to the related `interestKey`,
   which both consumers already import); the helpers module re-exports it so no
   downstream import churned. Also fixes an odd dependency direction (a route page
   was depending on a profile-component's internal helper).

Net −18 lines. All behavior-preserving.

## Filed this pass (net-new, small, reversible)

| Issue       | Item                                                                                                                                                                                                                                                                                                                                                                | Sev |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **AIR-625** | Decompose `chat.ts` (948 LOC) — extract the pure `buildInterestSnapshots`+`buildChatPrompt` region (lines 180–469, ~290 pure lines) into `chat-prompt.ts` first. The last remaining ~950-LOC god file; `server.ts` already got this treatment (PER-274). Tracer-bullet, not a big-bang.                                                                             | MED |
| **AIR-626** | `companion.ts` client swallows every transport failure silently — 6 bare `catch { return false/null/[] }` (lines 72/114/158/519/633/724), no logging. The transport feeding the `RunFailure` "brief silently stopped" surface can itself go dark undiagnosably. Add an additive `logCompanionError()`; no control-flow change. Distinct from AIR-363 (server-side). | MED |
| **AIR-627** | `ChatChange.op` vocabulary enumerated in 3 unsynchronized spots; persisted `state.ts:64` union omits `"rewrite"`, so a confirmed rewrite persists as `op:"update"` (`chat.ts:828`). Single `ChatOp` source of truth + a documented persistence decision. Currently benign.                                                                                          | LOW |

## Net-new findings NOT filed (folded into existing issues / catalogued)

These are real but either overlap a tracked issue's scope or are best handled as
part of one — logged here so a future pass or the owning issue can absorb them,
without spamming duplicate tickets:

- **Web↔agent wire contract has no shared home.** `AgentBrief`, chat wire types
  (`ChatChange`/`PendingDelete`/`PendingRewrite`/`ChatTurn`), `TopicStatus/Coverage/
Basis`, `CompanionSchedule`, and the brief-markdown format (`STORY_DATE_RE` etc.)
  are each hand-copied into `src/lib` with "Mirrors the agent's…" comments and have
  **already drifted** (e.g. web `AgentBrief.status: string` vs agent's `"pending"|
"ready"|"failed"` union). This is the dominant structural theme. **Anchor issues:**
  AIR-272 (pin the date-token wire contract) and AIR-376 (extract the brief-markdown
  parser). Recommend widening AIR-272 into a small shared-types seam rather than a
  big-bang — the boundary is already crossed once (`skills.ts` imports `SEARCH_SKILLS`
  from the agent), so a `@scout/shared` shape module is feasible. Not a solo pass fix.
- **Duplicated `claude` subprocess client** (`chat.ts` vs `research.ts`: identical
  argv, niceness, decoder, error mapping) — and the copies drifted, which **is** the
  AIR-540 symptom (research has a timeout; chat has none). The clean fix is one
  `spawnClaude({allowedTools,timeoutMs,signal})`. **Tracked:** AIR-540 / AIR-198.
- **`state.json` reload-before-persist dance copied 4×** and two single-flight
  reclaim guards with divergent constants (run 30 min vs chat 5 min). A `mutateState`
  primitive dissolves both. **Tracked:** AIR-537 (lost-update race).
- **`POST /v0/weekly-brief` writes a `kind:"weekly"` brief into the single
  last-writer-wins `last_brief` slot** the daily poller reads. **Tracked:** AIR-374.
- **UI duplication:** interest-recovery cascade (`bootstrap→fetchFull→fallback→merge`)
  hand-written in 3 components; feed-card shell duplicated (`FeedView` vs `liked`);
  `ProfilePageShell` exists but only 1 of ~7 `/app/*` pages uses it; `formatDate`/
  `faviconFor` laundered through the `FeedView` component instead of `lib`; ~10 files
  repeat an identical `eslint-disable react-hooks/set-state-in-effect` mount-hydration
  suppression (the strongest signal a shared `useHydratedState` hook is missing).
  Adjacent to **AIR-375** (decompose AppPage) and **AIR-377** (dedup connect poll);
  good follow-on candidates, none urgent.
- **`companion.ts` throw-vs-swallow public API is inconsistent** (some paths throw,
  siblings return `null/[]`; `pollBriefsRaw` does both in one function). Larger
  contract decision; pairs naturally with the AIR-626 observability work.
- **`execFile` calls in `service.ts`** (launchctl/which) have no timeout — low,
  CLI-only (off the request path); fold into the spawn-helper work.

## Already tracked — confirmed open, NOT re-filed

AIR-177 (500 body leak) · AIR-178 (cap transcript) · AIR-179 (cleanup-catch
observability) · AIR-195/196 (chat race / corrupt transcript) · AIR-198 + AIR-540
(spawnClaude + chat timeout) · AIR-272 (date-token contract) · AIR-362 (fetch-timeout
constants) · AIR-363 (correlation IDs) · AIR-374 (weekly-brief slot) · AIR-375
(AppPage) · AIR-376 (brief-markdown parser) · AIR-377 (connect poll) · AIR-378 (open-
story identity) · AIR-380 (parseChatOutput) · AIR-452 (web unit harness) · AIR-536/
537/538/539 (state read/lost-update/null-body/manual-run deadline) · AIR-599 (chat
retry dup) · AIR-610 (dead Apify scaffold) · AIR-611 (rewrite Apply no Undo) ·
AIR-621 (interest-doc sanitize) · AIR-622 (pnpm.overrides warning).

## Non-issues checked (verified healthy)

- `safe-storage.ts` is a clean deep module — the correct consolidation of a guard
  that was copy-pasted into four places. `errors.ts#readErrorBody` dedup is complete
  and consistent across all error-body parse sites.
- The agent package is disciplined about failure logging — nearly every `catch` is
  documented and logged (`[server]`/`[runner]`/`[chat]`/`[state]` prefixes); no silent
  swallow of real failures found there. The observability gap is **web-side only**
  (AIR-626).
- No `TODO/FIXME/HACK`, no `as any`, no `@ts-ignore` in tracked source.
