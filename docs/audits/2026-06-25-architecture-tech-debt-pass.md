# Architecture & tech-debt review — 2026-06-25 (AIR-206)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this same Quality Pass (AIR-200…AIR-207)
and are deliberately left to them.

**Baseline this pass: 128 agent tests pass, typecheck clean, lint 0 errors /
27 warnings (unchanged).**

## Overall read

The codebase is healthy. Two thorough architecture passes landed in the last day
(AIR-188 on the agent server, CAR-132 on companion/error dedup), and they left a
well-shaped, non-duplicated backlog of the remaining structural debt. The clean
`@scout/agent` companion ↔ Next.js web split holds; `errors.ts` centralizes
error-body parsing; `companion.ts` is dense but well-documented and contract-
tested. The debt is now **specific and tracked**, not structural rot — so this
pass is intentionally light: one safe direct fix, no big-bang anything, and no
re-filing of items already on the board.

## Fixed directly this pass (small, clearly-safe, build/lint/test green)

1. **Scheduler validator drift (AIR-188 L1 — closed).** `scheduler.nextFireAt`
   parsed `time_of_day` with its own stricter regex `^(\d{2}):(\d{2})$`, while
   the canonical `state.normalizeTimeOfDay` accepts `H:MM` and zero-pads. A
   `"7:00"` reaching the scheduler by any path that skipped normalization (a
   hand-edited or legacy `state.json` — `loadState` does not normalize
   `time_of_day`) parsed as `null`, **silently disabling the daily schedule**.
   Routed `nextFireAt` through `normalizeTimeOfDay` so there is now one validator
   and no drift. Behavior-preserving for every valid 2-digit input; the only
   change is that recoverable `H:MM` inputs now schedule instead of silently
   dying. 128 tests green. (`packages/agent/src/scheduler.ts`)

## Verified already-tracked — deliberately NOT re-filed

The standing architecture backlog already covers the real remaining seams:

- **AIR-197** — `server.ts` route-table / `withAuthedJson` refactor (1095-LOC
  god-handler; duplicated auth+body+401 preamble; hand-maintained
  `V0_ROUTE_METHODS` that can drift from the handler chain).
- **AIR-198** — shared `spawnClaude()` + missing chat per-session timeout
  (`research.ts` and `chat.ts` near-duplicate spawn/error-mapping; chat has no
  timeout, so a hung child wedges the slot until the 5-min sweep).
- **AIR-196** — `readChatTranscript` blanket `catch { return [] }` still wipes
  history on any non-ENOENT corruption (atomic writes from AIR-188 closed the
  torn-write *source*, not the read-side blast radius).
- **AIR-195** — confirm-delete/rewrite TOCTOU race vs. an in-flight model turn
  (guards on `chatInFlight` but never sets it → last-writer-wins lost update).
- **AIR-178** — unbounded chat transcript growth / whole-file poll read.
- **AIR-177** — `/v0` 500 handler leaks `String(err)` to the client (same leak
  class also at `runner.ts:392`, `chat.ts:438/821` — folded into AIR-177 scope).
- **AIR-129** — no frontend test harness; add vitest over the pure seams
  (`parseArticlesFromMarkdown`, brief mappers, ingestion gate).
- **CAR-132 A/B/C** — server body-parse dedup, fire-and-forget observability,
  shared browser SSR-guard/abortable-effect hooks.

## Noted, low value — recorded not filed

- **`/v0/briefs` `since` ignored when `limit`/`offset` present** (AIR-188 L5):
  on re-inspection this is *by design* — pagination is offset-based and the
  handler comment documents the two distinct contracts. No action.
- **`weekly.ts LINK_RE` `/g` + manual `lastIndex = 0`** (AIR-188 L3): real
  footgun in principle, but it does a single `.exec` already defended by the
  reset. Cosmetic; not worth a change on its own.
- **Scattered magic fetch-timeout constants** (1500/2000/5000/8000/10000ms in
  `companion.ts`): low-ROI; fold into a named-constants cleanup only if AIR-197
  touches the file. Borders the perf lane.
- **`storage.ts` save/clear SSR-guard asymmetry**: `saveSettings`/`saveLastBrief`
  /`savePrevBrief` omit the `typeof window` guard their `clear*` siblings have.
  Harmless today (only called from client handlers); the dedup belongs to
  CAR-132 C, already filed.

## Disposition

One safe fix landed; findings doc written; no new issues filed because the
larger items are already tracked and well-scoped. Closing `done`.
