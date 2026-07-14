# AIR-718 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-07-14. Audited at `main` HEAD
`71b2f1f`; source frozen since the AIR-705 fix `9473525` (only a docs commit has
landed since). This pass's fix lands on top._

## TL;DR

Scout's `@scout/agent` companion ↔ static Next.js web split remains structurally
sound — this is the ~18th architecture pass on a **very well-tended** codebase,
and the third of *today*. The standing structural debt is comprehensively **and
accurately** tracked (all 8 standing-findings issues re-verified open this pass —
see table). Since AIR-705 (~an hour earlier) there is again **no new source
diff**, so rather than re-run the identical scan and manufacture findings, this
pass verified the tracking, independently re-scanned the freshest surfaces, and
**implemented the one already-scoped small/additive/observability fix that
genuinely moves the needle** (AIR-626) with a refinement.

**Landed 1 small, additive, behavior-preserving change** (`src/lib/companion.ts`):
observability logging on the browser→loopback transport, resolving the
long-tracked AIR-626. **Filed no net-new fix-issues** — everything else maps to an
already-open issue, all of which were re-confirmed open.

**Tree left green:** `tsc --noEmit` clean · `pnpm lint` 0 problems · `pnpm
test:web` **55/55**.

## Method

1. Confirmed source frozen since AIR-705 (`git diff 9473525 HEAD -- . ':(exclude)docs/**'`
   → empty; working tree clean).
2. Independent scan for un-tracked debt: no empty `catch {}` swallows outside the
   known set, **zero** TODO/FIXME/HACK markers, `eslint-disable` inventory clean
   (the ~9-file `react-hooks/set-state-in-effect` mount-hydration pattern is the
   AIR-619 catalogued item, deliberately unfiled — heterogeneous effects, no clean
   single hook; the `@next/next/no-img-element` disables are intentional and
   commented).
3. "New debt is likeliest on the freshest surface" — read the two most recent
   *source* commits' files directly (`storage.ts` from `8afb3fd`, `safe-storage.ts`
   from the AIR-326 consolidation, and the AIR-705 `useDisclosure` nav hook). All
   clean and well-documented; the `isSettings` malformed-input guard is exactly the
   right shape.
4. Re-verified every standing-findings issue is still genuinely open (below).

## Landed this pass — AIR-626 (companion.ts transport observability)

Every `catch` in the browser→loopback client `src/lib/companion.ts` was a bare
silent swallow returning a falsy/empty fallback with no trace. This is
self-defeating: the same file builds the whole `RunFailure`/`assessRunFailure`
surface (PER-258/259) so a user can *see* "my brief silently stopped updating" —
yet the transport that feeds it could go completely dark, making that exact
failure class undiagnosable from the browser console.

**Fix:** added one `logCompanionError(context, err)` helper
(`console.error("[companion] <context> failed", err)`) and wired it into the
**four data-fetch** catch sites — `config-fetch`, `latest-brief-fetch`,
`run-failure-fetch`, `brief-history-fetch`. Purely additive: no return value or
control-flow change; callers still get their existing fallback.

**Refinement over the filed scope (a deliberate CTO call):** AIR-626 listed all
six catch sites, but **two are discovery probes** — `isServedFromCompanion`
(same-origin `/healthz`, which fails *by design* on the marketing host that has no
`/healthz`) and `pingPort` (the loopback port sweep, which misses most ports on
every run). A negative probe is the *expected* result, so logging there would be
per-page-load noise that drowns the signal. Those two are left silent **with an
explanatory comment** so the asymmetry reads as a decision, not an oversight. This
ships the observability the issue's motivation actually wanted (the data paths that
go dark) without the noise the literal 6-site version would have introduced.

Verified green (typecheck / lint / `test:web` 55/55 incl. `companion.test.ts`).
AIR-626 closed as done.

## Standing findings — current state (all re-verified OPEN; do NOT re-file)

| Item | Issue | State (verified this pass) |
|---|---|---|
| Extract shared `spawnClaude()` (chat.ts had no per-session timeout) | AIR-198 | **backlog** (timeout itself fixed via AIR-540; the shared-helper extraction remains) |
| Decompose `AppPage` god-component (727 LOC) | AIR-375 | **backlog** |
| Extract + test brief-markdown parser out of `companion.ts` | AIR-376 | **backlog** |
| Decompose agent `chat.ts` (1046 LOC) — pure prompt-builder seam first | AIR-625 | **backlog** |
| `companion.ts` transport swallowed failures silently | AIR-626 | **DONE this pass** ✅ |
| `POST /v0/weekly-brief` clobbers single last-writer-wins brief slot | AIR-374 | **backlog** |
| `state.json` lost-update race (router-snapshot save clobbers a run's write) | AIR-537 | **backlog** |
| `readBody` destroys socket before the 413 is written | AIR-640 | **backlog** |

## Watch items (documented, no action needed now)

- **Two ~1000-LOC modules concentrate churn:** agent `chat.ts` (1046) and
  `companion.ts` (924). Decomposition tracked (AIR-625 / AIR-375 / AIR-376); neither
  urgent.
- **Web↔agent wire types are hand-copied** (`AgentBrief`, chat wire types, brief
  markdown) and have drifted before. Partially anchored by AIR-376. A `@scout/shared`
  shape module would dissolve it but is a multi-file seam, not a solo pass fix.
- **Single-process global mutable state** (`chatInFlight`, unsynchronized
  `state.json` R-M-W) remains the failure mode to watch as the app grows. Tracked
  (AIR-537).
- **Wrong-repo backlog:** the "deep-audit airbnb-assistant" issues reference a
  *different* product's files absent from this `scout` repo. Already flagged
  (AIR-673, blocked). Not an architecture item.

## Assessment

The architecture is in good shape and prior passes have worked the structural debt
down thoroughly and tracked it accurately. With source frozen and no new diff, the
highest-value move was not manufacturing a finding but *retiring* a genuine,
already-scoped observability gap — done here, with a small refinement that keeps
the new logging high-signal. No new fix-issues are warranted; the remaining tracked
items are all larger, own-issue refactors correctly deferred to the eng loop.
