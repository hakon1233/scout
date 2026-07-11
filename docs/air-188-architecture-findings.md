# AIR-188 — Architecture & tech-debt review

Recurring Quality-Loop pass (CTO). Reviewed the current codebase: the Next.js
static-export front-end (`src/*`) and the `@scout/agent` loopback companion
(`packages/agent/src/*`). Baseline before this pass: **127 agent tests pass,
0 lint errors, typecheck clean**.

The standing tech-debt backlog already covers the obvious front-end seams
(AIR-97/98/99 error-handling, AIR-128 dedup helpers, AIR-129 unit tests) and the
prior agent-server review (AIR-177/178/179). This pass focused on *untracked*
findings in the agent server, which carries the most logic density
(`server.ts` 1095 LOC, `chat.ts` 841 LOC).

## Fixed directly this pass (small, clearly-safe, build/lint/test green)

1. **Atomic chat-transcript writes (data-loss fix).** `writeChatTranscript` did a
   bare `fs.writeFile`, unlike `state.json` which uses temp+rename. A torn write
   (crash/concurrent append) left corrupt JSON; `readChatTranscript`'s
   `catch { return [] }` then read it as empty, and the next append *overwrote*
   the file — permanently wiping chat history. Extracted the existing atomic
   write into a shared `atomicWriteFile()` helper in `state.ts` and routed both
   `saveState` and `writeChatTranscript` through it. Behavior-preserving; removes
   the torn-write source of corruption and deduplicates the pattern.
   (`state.ts`, `chat.ts`)

2. **Removed 4 unused `eslint-disable` directives** in `src/app/app/page.tsx`
   (2× `set-state-in-effect`, 2× `exhaustive-deps`) that the linter flagged as
   no-ops. Lint warnings 31 → 27. Pure hygiene.

## Filed as small reversible fix-issues (larger / behavior-changing)

- **H1 — confirm-path TOCTOU race** (`chat.ts` `confirmDeleteTurn` /
  `confirmRewriteTurn`): both guard on `chatInFlight` but never *set* it, so a
  model turn kicked in the async gap interleaves a last-writer-wins save on the
  whole `interests` array → lost update. The "reload before persisting" comment
  is misleading: reload-then-save doesn't prevent it.
- **H2 — read-side transcript hardening**: even with atomic writes (fixed
  above), `readChatTranscript`'s blanket `catch { return [] }` still silently
  wipes history on *any* unexpected corruption. Distinguish ENOENT from parse
  errors; preserve a corrupt file aside instead of letting the next append
  destroy it.
- **M3 — `server.ts` route-table refactor**: the request handler is a single
  ~650-line `if`/`else` chain mixing routing + auth + CORS + validation +
  business logic + static serving, with a hand-maintained `V0_ROUTE_METHODS`
  table that can silently drift from the handler chain (new route → 404 instead
  of 405). Also folds in the duplicated 7× auth+body+401 preamble (a
  `withAuthedJson` wrapper) and the double `loadState` per request.
- **M4 — shared `spawnClaude()` + missing chat timeout**: `research.ts` and
  `chat.ts` near-duplicate the spawn/niceness/error-mapping logic and have
  already drifted — `research.ts` has a hard per-session timeout, `chat.ts` has
  none, so a hung `claude` chat child wedges the chat slot until the 5-min
  stale-pending sweep. Extract a shared helper that closes the timeout gap.

## Noted (low priority — not filed, recorded here)

- **M5** — raw `String(err)` is persisted into state (and served to the client)
  in `runner.ts:~392`, `chat.ts:~817`, `chat.ts:~434`, not just the `/v0` 500
  handler that AIR-177 covers. Same leak class, wider blast radius — fold into
  AIR-177's scope.
- **L1** — `scheduler.ts` `nextFireAt` requires `HH:MM` (2-digit) while
  `state.ts normalizeTimeOfDay` accepts `H:MM`; a `"7:00"` written by another
  path passes load but silently disables the schedule. Share one validator.
- **L3** — `weekly.ts LINK_RE` is a module-level `/g` regex defended by manual
  `lastIndex = 0`; drop the `g` flag to remove the footgun.
- **L5** — `GET /v0/briefs` ignores `since` when `limit`/`offset` are present;
  `?since=…&limit=3` silently drops the `since` filter. Clarify or reject the combo.

## Already tracked — deliberately NOT re-filed

Front-end: AIR-97 (localStorage QuotaExceeded), AIR-98 (logging shim), AIR-99
(per-route error boundary), AIR-128 (dedup helpers), AIR-129 (vitest),
AIR-101/86/85 (dep/hygiene/docs). Agent server: AIR-177 (`/v0` error leak),
AIR-178 (unbounded transcript / whole-file poll read), AIR-179 (silent cleanup
catches), AIR-172 (snapshot invariant). Perf-flavored: AIR-173/174/175/100.
