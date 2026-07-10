# Architecture & Tech-Debt Review — 2026-06-26 (CAR-115)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to sibling lanes and are left to them.

**Recovery note:** this issue was restored after an adapter/auth failure. The
failure did not represent a product blocker; no source-work completion was
recorded before this pass.

**Green gate:** `pnpm test` passes: **137/137** agent tests.

## Overall read

The codebase is in good shape for the current product stage. The recurring
architecture passes from June 25-26 already fixed or documented the obvious
`@scout/agent` seams: startup run-slot wedging, transcript corruption handling,
silent temp cleanup, server route/body parsing debt, fire-and-forget
observability, browser hook extraction, and raw error leakage.

This pass therefore focused on the less-glamorous persistence and client-workflow
edges where a small refactor now avoids a later data-loss or maintenance tax.
The only direct code change is intentionally narrow and covered by the existing
agent test suite.

## Fixed directly this pass

1. **Intent-doc writes now use the shared atomic persistence helper**
   (`packages/agent/src/docs.ts`).

   `writeInterestDoc()` previously used a plain `fs.writeFile()` after creating
   the interest-doc directory. That contradicted the module header's claim that
   intent docs reuse the same storage hardening as `state.json`, and it left
   `~/.config/scout/interests/<id>.md` exposed to torn/truncated writes on a
   crash or power loss mid-write. The state and chat-transcript paths already
   route through `atomicWriteFile()` for exactly this reason.

   Fix: import `atomicWriteFile()` from `state.ts` and use it for intent docs.
   The public interface, filename validation, owner-only mode, and existing
   tests remain unchanged; the implementation now writes to a unique sibling
   temp file and renames over the target atomically.

## Follow-up issues opened

1. **CAR-244 — Extract the companion persistence seam out of `state.ts`.**

   `docs.ts` now correctly reuses `atomicWriteFile()`, but that makes an existing
   module-shape smell more visible: `state.ts` owns both the state domain model
   and generic filesystem persistence primitives (`CONFIG_DIR`,
   `atomicWriteFile()`). A small follow-up should move the generic pieces into a
   `persistence.ts`-style module and have `state.ts`, `docs.ts`, and the chat
   transcript path depend on that deeper interface. This keeps durability policy
   local and stops unrelated stores from importing the state model just to write
   files safely.

2. **CAR-248 — Split `useProfileWorkbench()` along pure state-transition seams.**

   `src/components/profile/useProfileWorkbench.ts` is now a 600+ line hook that
   owns hydration, token/bootstrap IO, transcript mapping, change application,
   confirmation flows, typewriter timers, stop/retry/undo, and doc-card
   projection. The code is coherent but shallow as a single module: tests and
   reviews must reason about too many independent invariants at once. The
   low-risk path is not a rewrite; extract pure helpers/reducers first
   (`transcriptMessages`, `applyChanges`/delete-update projection, action-card
   resolution), then leave browser effects in the hook.

## Reviewed and not re-filed

- `server.ts` route-table / request-body / `ChatDeps` debt remains the largest
  backend seam, but it has already been covered by prior architecture passes and
  should not be re-filed from this recurring issue.
- Fire-and-forget / catch-and-swallow observability has been incrementally
  tightened in recent passes (`runner.ts`, `state.ts`, chat/server tails). No new
  untracked instance in `packages/agent/src` looked worth a direct change.
- The Next app page has repeated companion bootstrap/adoption effects, but the
  profile workbench split is the higher-leverage client-side first step. The app
  page can be revisited after that extraction establishes a local pattern.

## Net

One small durability fix landed; the hermetic agent suite stays green
(137/137). Two reversible follow-up issues capture the larger architecture work
without turning this recurring pass into a broad refactor.
