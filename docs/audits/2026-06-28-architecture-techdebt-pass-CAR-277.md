# Architecture & Tech-Debt Review - 2026-06-28 (CAR-277)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only:
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability, and small reversible refactors.

## Baseline

This pass used `docs/audits/2026-06-27-architecture-techdebt-pass-CAR-257.md`
as the immediate baseline and reviewed the meaningful code commits since then:

- `e5994be` - extracted companion filesystem persistence primitives into
  `packages/agent/src/persistence.ts`.
- `a8a061e` - extracted browser storage and abort hooks.
- `ffaa031` - corrected assembly-skill copy.
- `9e91da3` - deduped `/v0` JSON body parsing in `packages/agent/src/server.ts`.

The recent refactors are directionally good: generic filesystem persistence is
now a real module with multiple callers, request-body parsing is one local
helper inside the existing server module rather than a speculative adapter, and
browser storage writes now route through one central seam.

## Fixed this pass

### F1 - `safe-storage` did not guard the `localStorage` getter

`src/lib/safe-storage.ts` centralized browser storage degradation, but
`getLocalStorage()` still returned `window.localStorage` directly. In locked-down
or storage-disabled browsers, the getter itself can throw `SecurityError` before
`safeSetItem()` reaches its guarded `setItem` call. That reintroduced the exact
failure mode the module exists to contain, and every caller now depends on this
seam.

Fix: wrap the getter and return `null` when storage access is blocked, matching
SSR/no-window behavior. Added a regression test in `src/lib/safe-storage.test.ts`
that installs a throwing `localStorage` getter and verifies both
`getLocalStorage()` and `safeSetItem()` degrade without throwing.

Why in-pass: tiny, localized, covered by an existing focused test file, and it
improves all storage callers without changing their interfaces.

## Findings

### P1 - Web-side unit harness gap remains the highest-leverage architecture item

Already tracked as [CAR-259](/CAR/issues/CAR-259), not re-filed.

The browser-side pure modules are growing in the right direction:
`useProfileWorkbench.helpers.ts`, `safe-storage.ts`, `interest-docs.ts`, and
`errors.ts` are now small enough to test directly. The current `src/lib` test
file is run ad hoc with `tsx --test`, but the project-level `pnpm test` still
only runs the hermetic `@scout/agent` suite. A minimal web-side test harness is
still the next real leverage point because it makes these seams enforceable in
CI rather than relying on one-off commands.

### P2 - Standing agent/server architecture backlog is actively represented

Already tracked, not re-filed:

- [CAR-145](/CAR/issues/CAR-145) - shared server request parsing / `ChatDeps`
  cleanup.
- [CAR-146](/CAR/issues/CAR-146) - server-side observability for unhandled and
  fire-and-forget errors.
- [CAR-147](/CAR/issues/CAR-147) - shared browser hooks for SSR guard and
  cancellation.

The latest commits reduced rather than increased this debt. In particular,
`parseJsonBody()` removes repeated route-level body parsing, and
`persistence.ts` now carries the generic filesystem write module that state,
docs, and chat stores can share.

## Not filed

No new larger fix-issues were opened. The only concrete net-new defect found was
small enough to fix directly. The broader missing-test item is already tracked
by [CAR-259](/CAR/issues/CAR-259), and the remaining server/observability items
have open CAR issues.

## Verification

- `pnpm exec tsx --test src/lib/safe-storage.test.ts` - 3/3 pass.
- Full `pnpm test` was also run because this pass touches source under `src/lib`
  and the workspace guidance requires it before `/v0` or `packages/agent/src/*`
  changes. It validates the hermetic `@scout/agent` suite.

## Notes

The workspace had pre-existing dirty changes in `packages/agent/src/chat.ts` and
`packages/agent/test/chat.test.ts` before this pass's final diff check. This pass
did not modify or revert those files.
