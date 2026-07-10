# AIR-356 — Architecture & Tech-Debt Review

_Recurring quality-loop pass (CTO). Date: 2026-06-26._

## TL;DR

The `@scout/agent` companion is a well-maintained codebase: atomic writes,
concurrency guards, per-session timeouts, hermetic tests, and careful token
handling. The **major** structural debt is already tracked by open fix-issues
(see "Already tracked" below) — this pass deliberately does **not** re-file
those. One genuinely net-new, data-loss-class gap was found and **fixed
in-pass** (corrupt-`state.json` preservation). The remaining net-new items are
small and filed as reversible fix-issues, not done big-bang.

## Fixed in this pass (small, clearly-safe)

### F1 — `loadState` silently discarded a corrupt `state.json` before overwrite ✅ FIXED
- **File:** `packages/agent/src/state.ts` (`loadState`).
- **Problem:** On a present-but-corrupt `state.json`, `loadState` caught the
  parse error and returned `{}`. The very next `saveState` then atomically wrote
  fresh empty-ish state **over** the corrupt file — permanently destroying the
  founder's interests, briefs, schedule, and pairing token. Atomic writes guard
  *self-inflicted* torn writes, but **external** corruption (manual edit, disk
  fault, a restore that truncates, a pre-atomic-version write) still produces a
  present-but-corrupt file that this path would wipe.
- **Why net-new:** `chat.ts` already preserves a corrupt *transcript*
  (`preserveCorruptTranscript`, guarded by test CAR-195), but `state.json` — the
  far more valuable file — had no such protection. Asymmetric, untracked.
- **Fix:** Split `loadState`'s read vs. parse so ENOENT/first-run still silently
  returns `{}` (nothing to preserve), but a corrupt parse now renames the bytes
  aside to `<file>.corrupt-<ts>.bak` and logs `[state] …` before falling back —
  mirroring the existing chat-transcript pattern exactly. Best-effort: if the
  backup itself fails, behavior is unchanged (`{}`).
- **Tests:** new `packages/agent/test/state.test.ts` (2 tests, mirrors CAR-195):
  corrupt file is backed up & a clean save survives; a *missing* file is **not**
  backed up. `pnpm test` green (141 tests), `tsc --noEmit` clean, lint clean.

## Net-new items worth filing (small, reversible) — not fixed in-pass

These are real but exceed "clearly-safe one-liner"; recommend small fix-issues:

### N1 — Scattered, uncoordinated client fetch timeouts (low)
- **Where:** `src/lib/companion.ts` (1500/2000ms probes), `src/lib/chat.ts`
  (5_000/10_000ms), agent-side `SCOUT_SESSION_TIMEOUT_MS`.
- **Smell:** Each call site has its own magic number; no shared constant, so
  client and server timeouts can drift out of agreement (a client that aborts at
  5s while the server is mid-spawn yields confusing "failed" UX). Consolidate
  into one named-constants module. Behavior-preserving.

### N2 — No structured logging / correlation IDs at error boundaries (low–med)
- **Where:** `server.ts`, `runner.ts`, `chat.ts`, `research.ts` — all log plain
  `console.error` strings. The recent FLI-357 catch-all logs method+path, but
  individual routes/briefs/turns carry no `brief_id`/`turn_id`/`interest_id`.
- **Smell:** Cross-log diagnosis of "my brief failed" is manual string search.
  A tiny `log(level, fields)` shim threaded through the existing catches would
  make failures correlatable without a logging framework. Partially overlaps
  AIR-179 (observability on best-effort catches) — scope a fix-issue to the
  *request/run correlation* slice only, to avoid duplicating AIR-179.

## Already tracked — do NOT re-file

Confirmed open and covering the obvious agent/`/v0` debt; left untouched:

| Issue | Item |
|---|---|
| AIR-197 | Extract route table + `withAuthedJson` from the 1,100-line `server.ts` god-handler |
| AIR-198 | Extract shared `spawnClaude()` (research.ts/chat.ts duplicate spawn+timeout+niceness; chat lacks per-session timeout) |
| AIR-195 | Chat confirm-delete/rewrite race vs. in-flight turn (lost update) |
| AIR-196 | `readChatTranscript` corrupt-read handling (note: preserve-corrupt **already present in code**; issue may be closable) |
| AIR-177 | `/v0` 500 handler leaks `String(err)` internal detail to client |
| AIR-178 | Cap chat transcript growth (last-N turns) |
| AIR-179 | Observability on best-effort cleanup catches (orphan temp dirs/files) |
| AIR-272 | Pin story date-token wire contract across agent↔web (contract test) |

## Verified NON-issues (don't file)

- `os.setPriority(...)` in both spawn paths is **already** wrapped in try/catch
  (research.ts, chat.ts) — niceness is advisory, no crash risk.
- The `String(err)` 500-leak is **already tracked** (AIR-177); FLI-357 already
  added stderr logging for the catch-all. Not re-filed.
- No `TODO/FIXME/HACK` markers anywhere in `packages/agent/src`.
- No Apify integration in the repo — web scraping is delegated to the `claude`
  CLI's WebSearch/WebFetch tools (hard-guardrail flow is not reachable here).

## Bottom line

Architecture is sound; no big-bang rewrite warranted. The needle-mover this pass
was closing the `state.json` corruption→wipe gap (F1, shipped). N1/N2 are filed
as small reversible follow-ups.
