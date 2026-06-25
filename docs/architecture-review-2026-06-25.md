# Architecture & Tech-Debt Review — 2026-06-25 (CAR-132)

Recurring quality pass focused **only** on architecture/tech-debt: module
tangling, duplicated logic, leaky abstractions, and missing error-handling /
observability. Bugs (CAR-128), perf (CAR-130), security (CAR-126), design
(CAR-127), docs (CAR-133) and product gaps (CAR-131) are out of scope here —
findings that belong to those lanes are deliberately left to them.

Codebase is healthy overall: clear `@scout/agent` companion vs. Next.js web
split, a good central `errors.ts`, and a well-tested agent package (127 passing
tests). The debt is mostly **boilerplate duplication** and **thin server-side
observability**, not structural rot.

## Fixed in this pass (small, safe, reversible)

- **Dedup companion error-body parsing.** The
  `await res.json().catch(() => ({ error: res.statusText }))` parse+cast was
  copy-pasted at 8 call sites across `src/lib/companion.ts` and
  `src/lib/chat.ts`. Extracted `readErrorBody(res)` into `src/lib/errors.ts`;
  each call site keeps its own `?? fallback`, so messaging is unchanged
  (behaviour-preserving). typecheck + lint + prettier + 127 tests green.

## Filed as fix-issues (larger, reversible — do NOT big-bang)

| # | Area | Why it matters |
|---|------|----------------|
| A | `packages/agent/src/server.ts` request-body parsing + `ChatDeps` duplication | The 1134-LOC request handler repeats the readBody→length-check→JSON.parse try/catch across 7 routes and rebuilds the identical `ChatDeps` object 3×. A `parseJsonBody()` helper + a hoisted `chatDeps` removes ~150 LOC and makes route behaviour consistent. Self-contained, no behaviour change. |
| B | Server-side observability for unhandled & fire-and-forget errors | `server.ts` global catch returns `{error}` JSON to the client but never logs to stderr; `void runSynthesis(...)` / `void runChatTurn(...)` and the `.rm(...).catch(()=>{})` cleanup swallow failures silently. Add `console.error` on these failure paths (additive, low-risk) so ops/QA can diagnose "my brief failed" from logs. |
| C | Extract shared browser hooks (SSR-guard + AbortController/cancellation) | The `if (typeof window === "undefined") return …` localStorage guard is repeated 12+ times, and the `AbortController` ref + `let cancelled = false` cleanup pattern is duplicated across `app/page.tsx` and `useProfileWorkbench.ts`. A `useAbortableEffect()` / `isClient()` helper removes the boilerplate and the risk of one site forgetting cleanup. |

## Noted but deliberately NOT filed (low value or other lane)

- Scattered magic fetch-timeout constants (1500/2000/5000/8000/10000ms) — real
  but low-ROI; fold into issue A/C if those land. Borders perf (CAR-130).
- No runtime validation of fetched JSON against expected shape (`as` casts) —
  acceptable while the companion contract is stable and versioned by tests.
- No `<ErrorBoundary>` around large page components — UX/resilience; defer to
  design (CAR-127) or a future hardening pass.
- `activeFilter` not reconciled when an interest is deleted — that's a behaviour
  bug; belongs to the bug-hunt lane (CAR-128), not architecture.
