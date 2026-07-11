# Architecture & Tech-Debt Review — 2026-06-26 (CAR-225)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes and are left to them.

**Baseline & green gate:** typecheck clean; `pnpm test` **134/134** pass before
and after the change. One small observability fix applied (see "Net").

## Overall read

This pass scanned the **larger, less-reviewed** modules that the prior
CAR-211 pass did not deep-read — `runner.ts` (489 LOC), `chat.ts` (890 LOC),
`service.ts` (287 LOC) — looking only for *genuinely new, untracked, small,
clearly-safe* debt. One real catch-and-swallow-with-no-observability gap was
found and fixed directly; the remaining candidates were verified false
positives or invariant-critical code not worth a unilateral change.

## Fixed this pass (small, reversible)

- **`runner.ts:460` — ephemeral-dir cleanup silently swallowed `fs.rm` errors.**
  The `finally` block removed an ephemeral run's throwaway intent-doc dir
  (PER-218) with `.catch(() => {})`. Best-effort cleanup is correct (a failed
  rm must not wedge the run), but the bare swallow meant a permission error or
  race that leaves the dir on disk was *completely invisible* — throwaway dirs
  could accumulate and eventually exhaust `/tmp` (ENOSPC) over many runs with
  zero signal. Fix: log the failure at `console.warn` with the `[runner]`
  prefix (matching the module's existing `console.error` convention), keeping
  the best-effort no-wedge guarantee while making the leak observable. 6 lines,
  no behavior change beyond the added log line.

## Candidates scanned and verified NOT real (no change, no issue)

1. **`chat.ts:777` "`confirmRewriteTurn` writes the doc before any try/catch,
   unlike `confirmDeleteTurn`."** Not real. `confirmDeleteTurn` (`chat.ts:709`)
   has the *identical* structure — neither confirm path wraps its
   write/apply in a try/catch; both intentionally let a disk error propagate to
   the HTTP layer. The two paths are symmetric, so there is no asymmetry to fix.

2. **`chat.ts:837` "`applyChatChanges` should apply changes granularly instead
   of failing the whole turn atomically."** Not a clearly-safe change. Atomic
   turn failure is the intended contract (the turn lands as `failed` and writes
   nothing partial); switching to per-change partial application would be a
   behavior change toward *partial* on-disk writes — strictly riskier, not
   safer. Out of scope for a quality pass.

3. **`runner.ts:126` / `chat.ts:650` "`isStalePending` and `isStalePendingChat`
   are duplicated and should be deduped."** Real duplication but deliberately
   left as-is. Each closes over a module-private mutable global
   (`runInFlight` vs `chatInFlight`) that is core to the wedge-prevention
   invariant, uses a different timestamp field (`generated_at` vs `created_at`)
   and a different grace window. Both are 6 trivial, individually-tested lines;
   extracting a shared helper would add a cross-module dependency on
   invariant-critical code for negligible gain. Divergence risk is low. Not
   worth a change or a fix-issue.

## Standing backlog already covers the real seams (not re-filed)

- **CAR-145** — dedup request-body parsing + `ChatDeps` in `server.ts`; route table.
- **CAR-146** — server-side observability for unhandled & fire-and-forget errors.
- **CAR-147** — extract shared browser hooks (SSR-guard + AbortController).
- **CAR-68** — error boundary + observability around the `nextMonth()` monthly tick.
- **CAR-69** — incrementally extract one leaf subsystem out of the `game.js` monolith.
- **CAR-180 / CAR-181** — raw-error-string leak to UI; in-app `error.tsx` boundary.

## Net

**One small observability fix** (`runner.ts` ephemeral-cleanup warn log) and the
verified record above. The reviewed `@scout/agent` modules remain healthy; the
larger structural items stay tracked by the standing backlog. Build / lint /
test remain green (134/134).
