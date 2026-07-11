# Architecture & Tech-Debt Review — 2026-06-26 (CAR-239)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes (parent CAR-232) and are left to them.

**Baseline & green gate:** `tsc --noEmit` clean; `pnpm test` **134/134** pass
before and after the change. One small observability fix applied (see "Net").

## Overall read

Six+ architecture passes this week (CAR-132 / AIR-188 / CAR-155 / CAR-174 /
CAR-195 / CAR-211 / CAR-225) have already filed or fixed the genuine structural
seams in `@scout/agent`. This pass deep-read the **Next-app `src/lib/` client
modules** that those `@scout/agent`-focused passes did not cover —
`companion.ts` (676 LOC), `likes.ts`, `interest-docs.ts`, `storage.ts`,
`errors.ts` — plus a repo-wide grep for the silent-error-swallow pattern the
recent passes have been fixing. The `src/lib` modules are uniformly clean,
heavily documented, and SSR-guarded; no new debt there. The grep surfaced one
genuinely-new, untracked instance of the exact pattern CAR-225 just blessed as
fix-worthy — fixed directly.

## Fixed this pass (small, reversible)

- **`state.ts:329` — orphan `.tmp` cleanup in `atomicWriteFile` silently
  swallowed `fs.rm` errors.** When the atomic write (`writeFile` → `rename`)
  fails, the `catch` removes the uniquely-named sibling temp file before
  re-throwing the original error. The cleanup was `.catch(() => {})` — a bare
  swallow. Best-effort cleanup is correct (a failed `rm` must not mask the real
  write error), but the silent swallow meant a permission error or race that
  leaves the temp behind was *completely invisible*: every failed save adds one
  `<file>.<pid>.<hex>.tmp` orphan to the config dir with zero signal. This is
  the **same pattern, and same reasoning,** as the `runner.ts:460` ephemeral-dir
  fix from CAR-225 — a sibling instance that pass didn't reach. Fix: log the
  cleanup failure at `console.warn` with the `[state]` prefix, keeping the
  best-effort no-mask guarantee and the re-throw intact. ~6 lines, no behavior
  change beyond the added log line. Tests stay 134/134.

## Candidates scanned and verified NOT real (no change, no issue)

1. **`ThemeToggle.tsx:43` — `catch {}` on `localStorage.setItem`.** Deliberate
   and correct. This persists the cosmetic theme choice; a quota / private-mode
   failure is genuinely non-critical and the in-memory state already reflects the
   toggle for the session. Logging here would be per-keystroke noise in private
   mode. Same intentional swallow as `likes.ts` `write()` (which documents it).
   Not worth a change.

2. **`storage.ts` — `saveSettings` / `saveLastBrief` / `savePrevBrief` /
   `clearLastBrief` lack the `typeof window === "undefined"` guard their `load*`
   / `clearSettings` siblings have.** Real asymmetry, but not a clearly-safe
   change to "fix": these are only ever called from client event handlers where
   `window` always exists, so adding the guard is defensive code for an
   unreachable branch — net complexity, no value. Prior passes (CAR-211 L4)
   explicitly rejected this class of change.

3. **`companion.ts` `refreshBriefViaCompanion` uses `briefs[0]` as "latest".**
   Not real. `pollBriefsRaw` hits the single-slot poller contract of
   `GET /v0/briefs?since=…`, which returns the newest matching brief first; the
   `[0]` read matches the documented server contract and is exercised by the
   `/v0` contract tests.

## Standing backlog already covers the real seams (not re-filed)

- **CAR-145** — dedup request-body parsing + `ChatDeps` in `server.ts`; route table.
- **CAR-146** — server-side observability for unhandled & fire-and-forget errors.
- **CAR-147** — extract shared browser hooks (SSR-guard + AbortController).
- **CAR-68** — error boundary + observability around the `nextMonth()` monthly tick.
- **CAR-69** — incrementally extract one leaf subsystem out of the `game.js` monolith.
- **CAR-180 / CAR-181** — raw-error-string leak to UI; in-app `error.tsx` boundary.

## Net

**One small observability fix** (`state.ts` temp-cleanup warn log, completing
the CAR-225 pattern) and the verified record above. The reviewed Next-app
`src/lib` client modules are healthy; the larger structural items stay tracked
by the standing backlog. Build / typecheck / test remain green (134/134).
