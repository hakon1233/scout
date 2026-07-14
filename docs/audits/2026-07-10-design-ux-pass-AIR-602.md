# AIR-602 Design / UX Audit

Date: 2026-07-10

Scope: this pass ran with the product code byte-for-byte identical to what
AIR-526 (2026-07-08) already audited — this workspace's branch tip hasn't
moved since that pass except for the AIR-526 audit-doc commit itself. Rather
than re-walk the same routes/screenshots AIR-460/470/511/526 already covered
(which would just re-confirm the same findings), this pass ran the angle
none of the last four passes ran: the actual automated e2e suite
(`e2e/*.spec.ts`, 23 specs over a real built-and-packed companion + static
export), plus a manual read of the components those four passes hadn't
individually opened (`ErrorBanner`, `Banner`, `AgentProgressPanel`,
`RunScopeSelector`, `Chip`, `Card`, `BriefHistory`, `FeedBody`, `ChatDock`,
`/app/connect`, `/app/settings`). No paid Apify scrape was run; the e2e
suite uses its own mocked companion/fixtures.

## Summary

One real, current defect: **AIR-441's copy change ("Research scope" →
"Assignment") broke two live e2e tests** in `e2e/responsive-chat.spec.ts`
that still asserted on the old string — `pnpm test:e2e` was red on this
branch. None of AIR-460/470/511/526 caught this because none of them ran
the e2e suite (all four did manual/Playwright-screenshot review only). Fixed
directly in this pass (small, reversible, test-only) rather than filed, per
the "keep tests green" guardrail — see Findings below.

Beyond that, the manual read of the previously-unopened components found no
new issues: `AgentProgressPanel` and `RunScopeSelector` are both
well-built (correct `role=status`/`aria-live`, `role=group`+`aria-pressed`,
44px touch targets, focus rings) and `RunScopeSelector`'s active-pill fill
is already covered by the existing AIR-274 `bg-surface-strong` token bug
(it's explicitly named in that report). `ErrorBanner`/`Banner` are correctly
alert/status-rolled. `ChatDock`'s sub-token tiny type and `/app/connect`'s
hardcoded terminal hex and unlabeled pairing-token inputs are the same
already-tracked clusters AIR-277/261/391/392 cover — confirmed still
present, not re-filed. `BriefHistory`'s empty/error paging states are
clear and correctly worded. No new accessibility, copy, empty/error-state,
or off-brand findings.

AIR-542 (P1: local `pnpm dev` never hydrates) and AIR-543–546 from AIR-526
are all still `backlog`, unassigned, unfixed — correctly tracked, not
re-filed. AIR-274 (`bg-surface-strong` undefined token, HIGH) is also still
open two weeks on despite an existing PR (#9) — flagged again below since
it's the single highest-severity open item from this audit lineage.

## Findings

### Fixed in this pass: e2e regression from AIR-441 copy change
`e2e/responsive-chat.spec.ts` (3 assertions, 2 tests) asserted
`getByText("Research scope")`, which AIR-441 renamed to "Assignment" in
`InterestScopeView.tsx`. `pnpm test:e2e` was failing on this branch as a
result. Updated the three assertions to `getByText("Assignment", { exact:
true })` — `exact: true` is required because the page also renders a
sibling "Assignment updated `<date>`" paragraph, which a plain substring
match would also catch, tripping Playwright's strict-mode multi-match
error. Verified: full `pnpm test:e2e` (23/23) and the hermetic
`packages/agent` suite (143/143) both green after the fix.

### Not new, re-flagged: AIR-274 `bg-surface-strong` undefined token (HIGH, open 2 weeks)
Still unfixed. Silently drops the fill on the selected `RunScopeSelector`
pill, the AppNav "Run now" trigger, and both `Chip` hover states, in both
themes. A fix already exists as an open, unmerged PR (#9, "design(tokens):
define missing surface-strong fill"). Not re-filing — flagging because it's
the most severe open item this audit lineage has produced and has now
survived four Design/UX passes without landing.

## Not Re-filed

Confirmed still open/tracked, not re-filed: AIR-237, 261, 274, 275, 276,
277, 278, 334, 347, 348, 373, 391, 392, 486, 487 (from AIR-460/470/511) and
AIR-542, 543, 544, 545, 546 (from AIR-526). AIR-440 and AIR-442 remain
`in_review`/open-PR (already fixed, awaiting merge).

## Verification

- `pnpm approve-builds` (esbuild/sharp/unrs-resolver) once for this
  workspace, then `pnpm exec playwright install chromium` (browsers were
  missing in this sandbox).
- Ran `pnpm test:e2e` (webServer builds + packs + boots the real
  `@scout/agent` tarball, serves the static export from its own loopback
  origin) — first run: 21/23 failed on missing Chromium binary (env-only,
  not a product bug) plus the 2 real `responsive-chat.spec.ts` failures
  above; after installing Chromium and fixing the assertions, 23/23 pass.
- Ran the hermetic `packages/agent` suite directly
  (`tsx --test test/*.test.ts`): 143/143 pass.
- Ran `eslint`/`tsc --noEmit`/`prettier --check` scoped to the changed file:
  clean.
- Default e2e port 47821 was held by an unrelated long-running
  `scout-agent` process from a different workspace (PID 63515, ~8 days up)
  — did not touch it; ran e2e with `SCOUT_E2E_PORT` set to a free port
  instead.
- An incidental `pnpm install`/`approve-builds` side effect modified
  `pnpm-lock.yaml` (dropped the `postcss >=8.5.10` security override,
  silently resolving a transitive `postcss@8.4.31` instead of the pinned
  `8.5.15`) and `pnpm-workspace.yaml` (persisted `allowBuilds`) — reverted
  both; neither is part of this change and the override looked
  security-motivated, not something to drop silently.
- No app source changed; only `e2e/responsive-chat.spec.ts` and this doc
  are committed from this pass.
