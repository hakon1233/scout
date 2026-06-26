# Architecture & Tech-Debt Review — 2026-06-26 (CAR-211)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes (parent CAR-204) and are left to them.

**Baseline & green gate:** typecheck clean; `pnpm test` **133/133** pass;
`eslint` 0 errors / 27 pre-existing `@next/next/no-img-element` warnings. **No
code changed this pass** (see "Net" below), so the gate is unchanged.

## Overall read

The `@scout/agent` companion's reviewed modules are healthy. Three+ prior
architecture passes this week (CAR-132 / AIR-188 / CAR-155 / CAR-174 / CAR-195)
have already filed or fixed the genuine structural seams. This pass did a fresh
scan of the **less-reviewed** modules (`coverage.ts`, `service.ts`, `state.ts`,
`weekly.ts`, `scheduler.ts`, `docs.ts`, `search-skills.ts`,
`assembly-skills.ts`, `static.ts`, `build-info.ts`, `cli.ts`) looking only for
*genuinely new, untracked* debt — and, after verification, found **none worth a
change or a new issue**. The candidates that surfaced were all false positives;
recording *why* here saves the next pass from re-investigating the same spots.

## Standing backlog already covers the real seams (not re-filed)

- **CAR-145** — dedup request-body parsing + `ChatDeps` in `server.ts`; route table.
- **CAR-146** — server-side observability for unhandled & fire-and-forget errors.
- **CAR-147** — extract shared browser hooks (SSR-guard + AbortController).
- **CAR-68** — error boundary + observability around the `nextMonth()` monthly tick.
- **CAR-69** — incrementally extract one leaf subsystem out of the `game.js` monolith.
- **CAR-180 / CAR-181** — raw-error-string leak to UI; in-app `error.tsx` boundary.

## Candidates scanned and verified NOT real (no change, no issue)

A focused scan surfaced five candidates. On reading the actual code each is a
false positive — documented here so they aren't re-raised:

1. **`weekly.ts:99` "undated stories bypass the freshness window."** Not real.
   Undated stories can only originate from a brief whose `generated_at` already
   passed the last-7-days filter (`weekly.ts:88–93`, `Number.isFinite && t >=
   cutoff`). An undated bullet is therefore bounded by its source brief's
   freshness — including it is intentional, and the test
   "buildWeeklyBrief drops stale stories…" already pins the dated path.

2. **`weekly.ts:104` "`Date.parse(sourceGeneratedAt)` can be `NaN` and break the
   sort comparator."** Not real. `sourceGeneratedAt` is the source brief's
   `generated_at`, and only briefs that passed `Number.isFinite(Date.parse(...))`
   at line 92 contribute stories — the value is always parseable by the time the
   sort runs.

3. **`weekly.ts:137` "`buildWeeklyBrief` is dead duplicate code."** Not real —
   it is the public alias the test suite imports
   (`test/weekly.test.ts:13,59,84`). Removing it would break tests for zero
   behavior gain; the one-line wrapper is a deliberate stable test entry point.

4. **`state.ts:219/230` "unbounded `id += '_'` collision suffix is a footgun /
   adversarial-input risk."** Not real. The id is derived from a SHA-256 hash of
   the topic, so a collision is astronomically improbable and not attacker-
   steerable; the suffix output stays `SAFE_ID`-valid. Adding a bound/UUID would
   be defensive code for an unreachable branch — net complexity, no value.

5. **`research.ts:128` SIGTERM→SIGKILL `.unref()` "drops the escalation timer."**
   Confirmed false positive in the CAR-174 pass and re-confirmed: `.unref()`
   only declines to *hold the loop open*; the timer still fires while the
   long-lived server process is alive. The kill escalation is documented
   best-effort.

## Spot-checks that confirmed good health

- **`scheduler.ts`** — the prior `nextFireAt` vs `normalizeTimeOfDay` format
  divergence (AIR-188 L1) is fixed and documented; `fire()` re-arms before
  kicking the run so the two `schedule.*` writers stay sequential. Clean.
- **`coverage.ts`** — `sectionBlocks` splits losslessly; `enforceBriefFreshness`,
  `mergeBriefSections`, and `sortSectionStoriesNewestFirst` all return the input
  byte-identical when there is nothing to change, keep undated/unparseable
  stories rather than dropping them, and preserve heading line-anchoring. Pure
  and well-tested. No defect.

## Net

**No code change and no new tracking issue this cycle.** The reviewed `@scout/agent`
modules are in good shape and the larger structural items remain tracked by the
standing backlog above. Forcing a change to "have a fix" would violate scope
discipline and intellectual honesty; the value this pass adds is the verified
record that these five spots are *not* bugs, so future passes don't churn on
them. Build / lint / test remain green (133/133).
