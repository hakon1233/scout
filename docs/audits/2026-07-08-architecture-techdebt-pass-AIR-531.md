# Architecture & Tech-Debt Review — 2026-07-08 (AIR-531)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability, and small reversible refactors. Bugs, perf,
security, design, docs and product gaps belong to their sibling lanes.

**Baseline & green gate.** Branch `chore/per-273-quarantine-supabase`, HEAD
`e5be170`. After this pass: `pnpm lint` **0 errors** (29 pre-existing `<img>`
warnings), source `tsc --noEmit` **clean**, `pnpm test` **155/155** (agent
hermetic) + **28/28** (web) — all offline. Three small, clearly-safe fixes
landed; four net-new fix-issues filed; one long-standing backlog item verified
resolved and closed.

## What actually changed since the last pass

The prior architecture passes (AIR-450, and the sibling-company CAR-257 /
CAR-277) reviewed the tree up to ~`9e91da3` and concluded the standing debt was
already well-tracked. Since then a **large stack of unreviewed commits** landed
on this branch — this pass scoped itself to that fresh surface rather than
re-scanning the settled tree a 16th time:

- `e1fb46c` (PER-274) — **decomposed the 1095-line `server.ts`** into a router +
  `routes/*.ts` handlers + a `V0_ROUTES` dispatch table.
- `ff2ef71` — hardened loopback host + token checks.
- `c6db91d` / `b3cf4e5` (PER-272) — `atomicWriteFile` fsync (file + dir) and
  `/healthz` corrupt-state surfacing.
- `18d1b2c` (PER-259) — auto-retry of silently-failed daily runs.
- `4299b23` (PER-267) — scaled the manual-run client deadline.
- `c98a413` (PER-271) — direct web unit tests for the markdown parser.

Two read-only reviewers were fanned out over disjoint slices of this surface
(server/routing; durability/state/scheduler) and their concrete findings were
hand-verified against the code and the open backlog before filing.

## Fixed this pass (small, clearly-safe, reversible)

### F1 — `pnpm run test:web` silently excluded an existing regression test

`test:web` was a **hand-maintained two-file list**
(`tsx --test src/lib/companion.test.ts src/app/app/page.test.ts`). The
`src/lib/safe-storage.test.ts` regression test added by the CAR-277 pass was
**never in that list**, so it did not run in `pnpm test` or CI — its protection
against the `getLocalStorage()` `SecurityError` regression was silently
unenforced. This is a drift trap: any future `src/**` test is excluded until
someone remembers to edit the script.

**Fix:** switch to a self-maintaining glob — `tsx --test 'src/**/*.test.ts'`
(Node 22's test runner globs it; CI is Node 22 across all workflows). Web tests
went 25 → 28 (safe-storage now runs). Behavior-preserving for the two files that
already ran; picks up the third and anything added later. Net-new, untracked.

### F2 — net-new `no-explicit-any` lint error would break the deploy gate

`packages/agent/test/version.test.ts:34` (added by `ff2ef71`) typed a helper's
response body `body: any`, tripping `@typescript-eslint/no-explicit-any` — the
**only** lint error in the tree, and the only `any` in the whole agent test
suite. `pnpm lint` exited 1. `ci.yml` and, critically, **`deploy.yml`'s
push-to-main gate both run `pnpm lint`**, so on merge this would fail the gate
and block the Pages deploy. A feature-branch push doesn't trigger `ci.yml`, so
it slipped in unnoticed.

**Fix:** typed the body honestly as `{ error?: string } | null` (the helper's
three consumers only read `.error`) and used optional chaining at those sites.
Pure type change, no runtime behavior change; `version.test.ts` 5/5 green, lint
back to 0 errors.

### F3 — `PUT /v0/schedule` could turn a committed write into a 500

`routes/schedule.ts` persisted the schedule (`saveState`, durable) and then
`await sc.onScheduleChanged?.()` **bare**. If the scheduler re-arm throws, the
exception escaped to the `/v0` 500 catch-all — reporting a _committed_ config
change as a failure the client can't cleanly retry, and leaking `String(err)`.

**Fix:** wrap the re-arm in a best-effort `try/catch` that logs and continues to
return the saved view. Additive crash-safety matching the existing
`runChatTurn` / `scheduler` `void …().catch()` convention and the AIR-432
confirm-turn fix. Behavior-preserving on the happy path. (Scoped to exactly this
change — an incidental whole-file prettier reformat was reverted; CI does not
gate prettier on agent `src`.)

## Filed this pass (small, reversible, net-new — need a test / more care)

| Issue       | Sev  | Item                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AIR-536** | high | `loadState` treats a transient read error (`EACCES`/`EIO`/`EMFILE`) like first-run `ENOENT` and returns `{}`; the next `saveState` then silently wipes `state.json` (pairing token, briefs, schedule) with **no `.bak`** — unlike the corrupt-_parse_ sibling. Fix: gate fresh-start on `ENOENT`, re-throw otherwise. `state.ts:299`.                                                            |
| **AIR-537** | med  | `state.json` lost-update race: mutating routes save the router's authed-time snapshot without reloading, so a `PUT /v0/schedule` can clobber a run's just-saved `ready` brief back to `pending`. General form of AIR-195 / AIR-374; the PER-274 router-snapshot pattern slightly widened it. Fix: single in-process writer or per-field CAS. `routes/schedule.ts:91`, `routes/interests.ts:149`. |
| **AIR-538** | low  | `parseJsonBody` accepts a literal `null` body → `parsed.message` etc. throws → every mutating `/v0` route 500s + `String(err)` leak. Bearer-gated. One-site fix: reject non-object bodies with 400. `http-util.ts:228`.                                                                                                                                                                          |
| **AIR-539** | low  | Manual-run companion poll deadline is unbounded (multi-hour hang if a run sticks `pending`) and its subset budget can mismatch the server's full-run fallback, resurfacing the false timeout PER-267 fixed. `src/lib/companion.ts:779`.                                                                                                                                                          |

## Verified resolved — backlog reconciled against the moved code

- **AIR-197** (extract route table + `withAuthedJson` from the god-`server.ts`)
  — **closed done.** Fully resolved by `e1fb46c` (PER-274): `V0_ROUTE_METHODS`
  is now _derived_ from the `V0_ROUTES` table (kills the hand-maintained drift),
  and `authed()` loads state once and passes it to handlers (kills the double
  `loadState`). `server.ts` 1095 → 329 lines, behavior-preserving.
- **AIR-376** (extract + unit-test the brief-markdown parser) — **kept open,
  commented.** PER-271 added `companion.test.ts` covering the parser (the "no
  test" half). Still open: the parser is not yet extracted out of the 825-line
  `companion.ts`, and the `IMAGE_RE`/`LINK_RE` shared-`/g`-`lastIndex` hazard
  (`companion.ts:396-405`) is unchanged.

## Considered, not filed / not changed

- **Stale `/healthz` invariant comment.** `server.ts:6-9,188-189` still say
  liveness "must answer no matter who asks," but `ff2ef71` put the host gate
  first, so a non-allowlisted `Host` now gets 403 (its own test asserts this).
  Doc-only nuance, low value; not worth churning core `server.ts` for. Noted
  here so a future ops author isn't misled.
- **Duplicated `interestId`/field extraction across chat confirm routes**
  (`routes/chat.ts`). Maintainability only, no failure scenario; a
  `requireStringField` helper would collapse it. Below the filing bar.
- **Durability primitive is correct.** `atomicWriteFile` fsyncs the temp file
  before rename and the dir after (`persistence.ts:36-66`); all state/doc/chat
  stores route through it. The PER-259 auto-retry loop is bounded (cap 3) and
  race-clean (`onScheduledRunDone` fires only after `runInFlight=false`). No
  action.
- **Unpruned `.corrupt-*.bak` files** + `/healthz` `readdir` per probe —
  negligible; not filed.

## Verification

- No paid API / scrape was run. There is **no Apify integration** in the repo;
  web research is delegated to the user's `claude` CLI (`WebSearch`/`WebFetch`),
  so the hard-guardrail flow is not reachable here.
- No secrets read or exfiltrated. The new `[schedule]` error log carries only
  the caught error, never the pairing token.
- Open AIR backlog read via the Paperclip issue API before deciding what was
  already tracked, what to file, and what to close. (CAR-/PER- identifiers in
  prior docs belong to sibling companies sharing this codebase; this company
  tracks under AIR-.)
- `pnpm lint` 0 errors, source `tsc --noEmit` clean, `pnpm test` 155/155 +
  28/28. Only three source files changed: `package.json`,
  `packages/agent/test/version.test.ts`, `packages/agent/src/routes/schedule.ts`
  (+ this doc). The pnpm-v11 lockfile rewrite (drops the now-ignored
  `pnpm.overrides`) was reverted each time it appeared.

## Method

CAM tools (`read_inheritance_context` / `append_work_log_entry` /
`write_parent_notes`) were **registered** this run and used. Reconstructed prior
context from `docs/audits/2026-06-28-…-CAR-277.md`,
`docs/audits/2026-06-27-…-CAR-257.md`, `docs/air-450-architecture-findings.md`,
the `b06399f..HEAD` git log, and the live open-issue backlog. Fanned out two
read-only review agents over the fresh (post-`9e91da3`) surface, hand-verified
every reported finding against the code and the tracked backlog, landed the
three clearly-safe fixes, scoped each diff to exactly its change, and re-ran the
full green bar.
