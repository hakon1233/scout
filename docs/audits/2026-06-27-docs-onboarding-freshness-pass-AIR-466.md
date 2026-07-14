---
name: docs-onboarding-freshness-pass-2026-06-27
description: AIR-466 docs & onboarding freshness pass — verified setup steps, confirmed which tracked docs-drift issues are still real, and flagged two that appear already resolved/stale.
type: reference
last_reviewed: 2026-06-27
---

# Docs & onboarding freshness pass — 2026-06-27 (AIR-466)

Recurring quality loop. Audited Scout's developer/user docs against the actual
source on `main`, verified the onboarding steps, and cross-checked the already
open docs-drift backlog so this pass does **not** re-file tracked items.

Outcome: **verify-and-report.** Scout's onboarding is in good shape and every
material docs drift is already captured by an open backlog issue. No new issues
filed (would duplicate), no direct fixes made (the clear ones are owned by
existing open issues). Two tracked issues look stale/already-resolved — flagged
for the board to re-check.

## Method / what was verified (against current `main`)

- `package.json` scripts vs README: every command the README references exists —
  `dev`, `build`, `start`, `lint`, `typecheck`, `format`/`format:check`, `test`,
  `test:e2e`, `build:agent`, `pack:agent`. ✓
- Companion onboarding steps: `pnpm -F @scout/agent build` is valid (workspace
  package is named `@scout/agent`); `node packages/agent/dist/cli.js pair|run`
  references real artifacts (`packages/agent/src/cli.ts` + built `dist/cli.js`);
  the documented loopback port `47821` matches `packages/agent/src/*`. ✓
- `.env.example` keys exist and are consistent with the documented Supabase +
  edge-function model.

## Findings

### A. Known drift — confirmed STILL real, already tracked (do NOT re-file)

| Evidence on `main` | Tracked by |
|---|---|
| README line 10 says "Next.js 15"; actual is `next@16.2.6` (`package.json`). | **AIR-421** (open) |
| README line 13 + `.env.example` line 10 say "Opus 4.7" as the synthesis model label. | **AIR-393** (open) |
| `.env.example` lists `ANTHROPIC_API_KEY` (+ `EXA_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) as required secrets, while README's "Environment variables" section states Anthropic and web-search creds are "**not** required anywhere in this repo" — an internal contradiction. | **AIR-329** (env-doc) + **AIR-393** + **AIR-394** (exa/EXA_API_KEY fate) (all open) |
| Root README onboarding flow predates the PER-110 same-origin companion flow. | **AIR-328** (open) |
| `packages/agent/README.md` "Endpoints" section stale (not independently re-verified this pass). | **AIR-454** (open) |

### B. Tracked issues that appear STALE / already resolved (recommend board re-check)

| Issue | Why it looks stale |
|---|---|
| **AIR-86** "Remove stale `bun.lockb` (repo standardizes on npm/package-lock.json)" | No `bun.lockb` exists anywhere in the scout repo; the repo uses **pnpm** (`pnpm-lock.yaml` + `pnpm-workspace.yaml`) and has no `package-lock.json` either. The issue's premise no longer matches the repo — **candidate to close**. |
| **AIR-345** "Fill out `docs/SYSTEM_OVERVIEW.md` (still an empty template)" | `docs/SYSTEM_OVERVIEW.md` is now **fully absent**, not an empty template, and no doc/index links to it (no `docs/README.md`), so there is no broken link. The issue's framing is stale; low priority — either close or rescope to "write a SYSTEM_OVERVIEW if still wanted". |

### C. New / untracked drift

- None material. Minor cosmetic only: the README documents two equivalent
  companion-build idioms (`pnpm -F @scout/agent build` in *Local development*
  vs `pnpm build:agent` in *Scripts*). Both work; not worth an issue.

## Guardrails honored

- Docs-only addition (this findings file). No code/build/lint/test impact.
- No secrets read or committed. Verification was static (reading source); no
  paid model calls and no scrape were run.
- Did not re-file any item already tracked by an open issue.
</content>
</invoke>
