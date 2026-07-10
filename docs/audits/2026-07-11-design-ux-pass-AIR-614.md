# AIR-614 Design / UX Audit

Date: 2026-07-11

Scope: this workspace's branch (`air-441/unify-assignment-copy`) has had no
product-code changes since the AIR-602 pass audited it two days ago — the
UI, copy, and component set are byte-identical to what AIR-460/470/511/526/602
already walked route-by-route and component-by-component across five
consecutive passes, all converging on the same tracked backlog with zero new
visual/a11y/copy defects. Re-walking the same static screenshots a sixth time
would not produce new signal, so this pass instead investigated *why* that
backlog — some of it flagged four times now (AIR-274) — still hasn't shipped,
since that's now the more consequential question than "is there a new bug."
No paid Apify scrape was run.

## Summary

**Headline finding: CI is failing `pnpm install --frozen-lockfile` on most
currently-open PRs, independent of what each PR actually changes — including
at least four Design/UX-audit-originated fixes.** This is new information,
not a re-flag: prior passes only ever noted that fixes were "unmerged," never
diagnosed why merges had stalled. Verified directly (not inferred) by pulling
CI logs for four unrelated open PRs:

- PR #20 (`a11y/air-407-appnav-dropdown-semantics`) — CI **FAILURE**
- PR #21 (`air-406/clarify-connect-status`) — CI **FAILURE**
- PR #22 (`air-441/unify-assignment-copy`, *this branch*) — CI **FAILURE**
- PR #24 (`design/car-179-liked-heading-order`, filed yesterday) — CI **FAILURE**

All four fail at the same step with the same error:
`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH — the current "overrides" configuration
doesn't match the value found in the lockfile`. Ruled out as a per-PR content
problem: these four PRs touch completely unrelated files (ARIA menu
semantics, connect-page copy, a global copy rename, a heading-tag fix), so a
uniform failure at the *install* step, before any of their code runs, points
at repo/environment config rather than any one diff. Also ruled out as
"just needs the already-known AIR-529 fix" (mirroring `pnpm.overrides` from
`package.json` into `pnpm-workspace.yaml`, merged to `main` 2026-07-08): PR
#24 already has that commit as an ancestor and still fails identically, so
whatever's wrong is either a second, distinct drift or an environment-level
pnpm version mismatch, not simply a stale branch. A local repro on this
machine (`pnpm --version` → `11.9.0`) surfaces a corroborating, if partial,
mechanism: pnpm 11 emits `[WARN] The "pnpm" field in package.json is no
longer read by pnpm... "pnpm.overrides"` — i.e. the *old* location of the
overrides config (still present in `package.json` on branches that predate
AIR-529, including this one) is now silently ignored, which is consistent
with a lockfile frozen against one config source disagreeing with a newer
pnpm reading a different one. `AIR-523` (open, unrelated Playwright ordering
bug) independently shows QA-live pinning `corepack pnpm@10.25.0`, while this
repo's CI workflows float `pnpm/action-setup@v4 version: 9` with **no**
`packageManager` field in `package.json` to pin an exact version anywhere —
so CI, corepack, and local dev are each free to resolve a different pnpm
release, which is the kind of drift that produces exactly this class of
intermittent, hard-to-repro lockfile error.

**Impact:** this is currently the single biggest thing blocking Design/UX
quality-loop output from shipping — bigger than any remaining cosmetic
finding. AIR-274 (HIGH, `bg-surface-strong` token, PR #9) has now been
re-flagged in four straight audits without landing; PR #9 itself predates
this failure mode and shows CI green, but three *newer* small, correct,
already-reviewed-by-nobody-because-CI-is-red fixes (PRs #20/21/24) are stuck
behind it too. Filed as a new, small, reversible, precisely-evidenced issue
below rather than continuing to just re-note "still unmerged."

Beyond that: no new accessibility, empty/error-state, copy, or off-brand
findings. `pnpm test` (hermetic `@scout/agent` suite) reconfirmed green,
143/143, on this branch.

## Findings

### P1: CI `pnpm install --frozen-lockfile` fails on most open PRs, independent of PR content
See **AIR-624** (new). Evidenced above across four unrelated PRs; recommended
fix is pinning pnpm to one exact version via `packageManager` in
`package.json` (currently absent) so CI/corepack/local dev can't drift, then
regenerating the lockfile once against that pinned version and confirming
`pnpm install --frozen-lockfile` is green in the actual CI environment.
Routed to Engineer — this is infra/tooling, not product code, and needs a
real CI run to verify (this sandbox's pnpm 11.9.0 doesn't match any of the
versions observed in CI or QA-live's corepack pin, so a local-only fix can't
be verified here).

### Not new, re-flagged a fifth time: AIR-274 `bg-surface-strong` undefined token (HIGH, open 17 days)
Still unfixed, still the highest-severity open item this audit lineage has
produced, still has a correct, CI-green, zero-review PR (#9) sitting idle.
Not re-filing a new issue — the fix already exists; see AIR-624 above for why
it (and its neighbors) likely can't get a clean merge signal right now.

## Not Re-filed

Confirmed still open/tracked, not re-filed: AIR-237, 261, 274, 275, 276, 277,
278, 334, 347, 348, 373, 391, 392, 486, 487, 542, 543, 544, 545, 546 (all
`backlog`, unassigned). AIR-440 and AIR-442 remain `in_review` (open PRs
#440/#442 exist as AIR-440/AIR-442's underlying work — see also PR #19 for
AIR-442). None of these needed a status change from this pass.

## Verification

- `pnpm test` (hermetic `@scout/agent` unit + `/v0` contract suite): 143/143
  pass, no regression since AIR-602.
- Did not re-run `pnpm test:e2e` or re-capture screenshots — AIR-602 already
  ran the full 23-spec e2e suite against this exact, unchanged branch tip two
  days ago (23/23 green); re-running against identical code would not add
  signal.
- CI investigation: `gh pr view <n> --json statusCheckRollup` +
  `gh run view <id> --log-failed` on PRs #9, 11, 14, 16–24; `git diff`/
  `git merge-base --is-ancestor` to compare each PR branch's `package.json`/
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` against `origin/main` and against the
  AIR-529 fix commit; local `pnpm --version` + `pnpm install --frozen-lockfile`
  repro. No product source was changed by this pass; only this audit doc and
  the new AIR-624 issue are new.
