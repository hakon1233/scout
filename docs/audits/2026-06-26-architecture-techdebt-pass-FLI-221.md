# Architecture & tech-debt review — 2026-06-26 (FLI-221)

Recurring Quality-Loop pass (CTO). Scope is architecture / tech-debt **only** —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability. Bugs, perf, security, design, docs and product
gaps belong to the sibling lanes in this same Quality Pass (FLI-215…FLI-222) and
are deliberately left to them.

**Baseline & green gate:** typecheck clean, `pnpm test` 128/128 pass, `eslint`
0 errors / 27 pre-existing warnings (all `@next/next/no-img-element`, unchanged).

## Overall read

The codebase remains healthy. The `@scout/agent` loopback companion ↔ Next.js
web split is clean, `errors.ts` centralizes error-body parsing, and the agent
package is well-tested (128 hermetic tests, claude shell-out mocked). The debt is
**specific and mostly already tracked**, not structural rot. This pass adds one
genuinely new finding the prior passes under-weighted, lands a small safe fix for
it, and files two FLI fix-issues for the largest remaining seams.

## Fixed directly this pass (small, clearly-safe, build/lint/test green)

1. **Fire-and-forget persistence failures were unhandled rejections, not just
   missing logs.** `startChatTurn` → `void runChatTurn(...)` (`chat.ts`) and
   `startRun` → `void runSynthesis(...)` (`runner.ts`) launch background work and
   return immediately. Each function has an _inner_ try/catch that lands a
   `failed` turn/brief for model errors, but the _outer_ persist tail
   (`loadState`/`saveState`/`appendChatTranscript`) sits in a `try { … } finally
{ … }` with **no catch**. A throw there (disk error, torn state, ENOSPC)
   escapes the function — and because the call site is `void`-ed, it becomes an
   **unhandled promise rejection**: invisible to ops, and a process-crash vector
   under Node's default `--unhandled-rejections=throw`. Prior passes (CAR-132 B)
   flagged this only as "add console.error for observability"; the real exposure
   is a latent crash, not a missing log line.

   Fix: attach `.catch((err) => console.error(...))` at both call sites. Behavior-
   preserving on the happy path (the promise was already not awaited); converts a
   latent unhandled-rejection into a logged, boundary-swallowed error. Logs only
   the `turnId`/`briefId` + error — never the opaque OAuth token (guarded by the
   PER-108 contract test, still green). `packages/agent/src/{chat,runner}.ts`.

## Filed as FLI fix-issues this pass (small, reversible — no big-bang)

| Issue | Area                                                           | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (A)   | `readChatTranscript` blanket `catch { return [] }` (`chat.ts`) | Atomic writes closed the torn-_write_ source, but the _read_ side still maps **any** error (non-ENOENT permission/IO error, or a corrupt-but-present file) to `[]`. The very next `appendChatTranscript` then overwrites the file — permanently wiping the user's whole chat history on a transient read blip. Small fix: treat ENOENT as "no history yet" but, on a parse/IO error of a file that exists, refuse to silently truncate (back up the corrupt file + surface). Reversible, self-contained. |
| (B)   | `server.ts` 1095-LOC request handler (`packages/agent/src`)    | The single god-handler repeats the readBody→length-check→`JSON.parse` try/catch across ~7 routes and rebuilds the identical `ChatDeps`/auth+401 preamble per route, with a hand-maintained `V0_ROUTE_METHODS` that can drift from the actual handler chain. Extract a `parseJsonBody()` helper + hoist `chatDeps` + a small route table. Removes ~150 LOC, makes route behavior consistent, no behavior change. Incremental, not a rewrite.                                                              |

## Verified already-tracked — deliberately NOT re-filed

The standing scout architecture backlog (tracked across the shared repo's other
Quality-Loop boards as AIR-195/196/197/198, AIR-177/178, AIR-129, CAR-132 A/B/C)
already covers: shared `spawnClaude()` + chat per-session timeout, the
confirm-delete/rewrite TOCTOU vs. an in-flight model turn, unbounded transcript
growth / whole-file poll reads, the `/v0` 500 handler leaking `String(err)` to
clients, and a frontend test harness over the pure seams. FLI fix-issue (A) above
is the one item with real data-loss blast radius that had **no** open FLI issue;
(B) is the one structural seam worth an FLI ticket. The rest are not re-filed.

## Noted, low value — recorded not filed

- **`storage.ts` save/clear SSR-guard asymmetry**: `saveSettings`/`saveLastBrief`/
  `savePrevBrief` omit the `typeof window` guard their `clear*` siblings have.
  Harmless today (only called from client handlers). Belongs to the CAR-132 C
  shared-hook dedup, already tracked.
- **Scattered magic fetch-timeout constants** (1500/2000/5000/8000/10000ms in
  `companion.ts`): real but low-ROI; fold into a named-constants cleanup only if
  the server.ts refactor (B) touches the file. Borders the perf lane (FLI-219).
- **`weekly.ts LINK_RE` `/g` + manual `lastIndex = 0`**: cosmetic footgun; the
  single `.exec` is already defended by the reset. Not worth a standalone change.

## Disposition

One safe fix landed (build/lint/test green); findings doc written; two FLI
fix-issues filed for the largest remaining seams; already-tracked items not
re-filed. Closing `done`.
