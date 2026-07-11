# Architecture & Tech-Debt Review — 2026-06-26 (CAR-174)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
module tangling, leaky abstractions, duplicated logic, risky patterns, missing
error-handling/observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this Quality Pass (CAR-167).

Baseline before this pass: **128 agent tests pass, typecheck clean, 0 lint
errors** (27 pre-existing `<img>` warnings). After this pass: **129 tests pass**
(one regression test added), typecheck clean, 0 lint errors.

## Context — the standing backlog already covers the obvious seams

Three prior architecture passes this week filed the high-value structural items;
re-filing them is explicitly out of scope:

- **CAR-132** (`docs/architecture-review-2026-06-25.md`): server.ts request-body
  + `ChatDeps` dedup; server-side observability for fire-and-forget errors;
  shared browser hooks.
- **AIR-188** (`docs/air-188-architecture-findings.md`): confirm-path TOCTOU
  race (H1); read-side transcript hardening (H2); `server.ts` route-table
  refactor (M3); shared `spawnClaude()` + chat timeout (M4).
- **CAR-155** (`docs/audits/2026-06-25-architecture-techdebt-pass.md`): fixed the
  `weekly.ts LINK_RE` `/g` footgun and the `scheduler.ts nextFireAt` vs
  `normalizeTimeOfDay` format divergence directly.

This pass therefore did a **fresh scan of the less-reviewed agent modules**
(`runner.ts`, `coverage.ts`, `service.ts`, `research.ts`, `state.ts`,
`scheduler.ts`, `weekly.ts`, `static.ts`) looking only for *genuinely new,
untracked* debt. It found exactly one — a real run-slot wedge — and fixed it.

## Fixed directly this pass (small, clearly-safe, behavior-preserving)

1. **`runner.ts` `startRun` wedges the run slot if the startup save throws
   (availability bug).** `startRun` claims the singleton `runInFlight = true`
   **synchronously** at the top (line 221) — correctly, before the first
   `await`, so a second concurrent `startRun` can't race in and double-start.
   But the very next steps — `await saveState(...)` (persisting the `pending`
   slot) and, for ephemeral runs, `await fs.mkdtemp(...)` — can throw (disk
   full, `ENOTDIR`, `EACCES`). The only code that resets `runInFlight` lives in
   `runSynthesis`'s `finally`, which is never reached when the throw happens
   before `void runSynthesis(...)`. Result: `runInFlight` stays `true` for the
   **life of the process**, so:
     - every later `startRun` returns `{ started: false, reason: "in_flight" }`
       forever, and
     - `isStalePending` short-circuits on `if (runInFlight) return false`
       (`runner.ts:128`), so the persisted pending can **never be reclaimed**
       either — exactly the PER-181 brick the stale-pending logic was built to
       prevent, reachable through a different door.

   **Fix:** wrap the `saveState` + ephemeral-dir setup in a `try { … } catch
   (err) { runInFlight = false; throw err; }`. The flag is still claimed
   synchronously (race-safety preserved); it's only released if the run never
   actually hands off to `runSynthesis`. The error still propagates to the
   caller unchanged. (`packages/agent/src/runner.ts`)

   **Regression test:** `runner.test.ts` → "CAR-174: a failed startup save
   resets runInFlight so the slot stays reclaimable" — points `startRun` at a
   state file whose parent is a regular file (`atomicWriteFile`'s recursive
   `mkdir` fails `ENOTDIR`), asserts the call rejects, then asserts a fresh run
   against a writable path still completes (`status: "ready"`) rather than being
   refused `in_flight`. Without the fix this test hangs (the second run is
   wedged and its synthesis-done callback never fires).

## Reviewed and deliberately NOT changed / filed

A focused sub-scan surfaced three more candidates; on inspection none is a real,
fileable defect:

- **`runner.ts` basis/`bases[]` asymmetry** — when a topic's `ensureInterestDoc`
  throws in the research loop, that topic gets `section: null` and the later
  `bases` loop may omit it. This is **documented, intentional degradation**
  (`runner.ts:336–343`): "a missing basis degrades to 'no basis shown' for that
  one topic, never a failed brief." A failed-research topic is reported
  "missing" by coverage anyway. No data is lost dishonestly. No change.
- **Overlapping-ephemeral-run temp-dir cleanup race** — would require two
  `runSynthesis` calls in flight at once. The `runInFlight` singleton serializes
  runs within a process (`startRun` refuses while one is live), so this
  interleaving cannot occur. False positive. No change.
- **`research.ts` SIGTERM→SIGKILL inner timer `.unref()`** (`research.ts:128`) —
  the kill escalation is explicitly **best-effort** (comment at lines 112–116)
  and the timer fires normally while the long-lived server process is alive;
  `.unref()` only declines to *hold the loop open*, it does not cause a pending
  timer to be dropped. Not a leak in practice. No change.

## Net

One real availability bug — a process-lifetime run-slot wedge on a startup-save
failure — fixed at the source with a guarding `try/catch` and a hanging-without-
the-fix regression test. No new tracking issues needed this cycle: the larger
structural items remain tracked by CAR-132 / AIR-188. Build/lint/test green
(129 tests).
