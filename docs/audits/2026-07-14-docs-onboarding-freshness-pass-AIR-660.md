---
name: docs-onboarding-freshness-pass-2026-07-14
description: AIR-660 docs & onboarding freshness pass for Scout. Verified onboarding docs against package scripts, runtime config, and the loopback companion implementation; identified three small docs-fix follow-ups.
type: reference
last_reviewed: 2026-07-14
---

# Docs & onboarding freshness pass - 2026-07-14 (AIR-660)

Recurring quality loop audit. Checked Scout's README, agent/contributor
instructions, companion docs, environment template, Supabase notes, package
scripts, workflow files, and relevant runtime config against the current tree.

Outcome: **report + small follow-ups.** The main onboarding path is mostly
current: Node 22 / pnpm 11 setup, static export, GitHub Pages deploy, local
`@scout/agent` companion, and hermetic test guidance all match the code and CI.
There are three focused docs drifts worth fixing separately.

## Method / evidence checked

- Root `package.json` vs `README.md`: package manager is `pnpm@11.9.0`; CI uses
  Node 22; scripts documented in README exist (`dev`, `build`, `start`, `lint`,
  `typecheck`, `format`, `format:check`, `test`, `test:e2e`, `build:agent`,
  `pack:agent`).
- `next.config.ts`: static export is still enabled via `output: "export"`;
  GitHub Pages `basePath` is derived from `GITHUB_REPOSITORY`; agent tarball
  version is sourced from `packages/agent/package.json`.
- `.github/workflows/ci.yml`, `deploy.yml`, and `publish-agent.yml`: CI/deploy
  use pnpm from `packageManager`, Node 22, `pnpm install --frozen-lockfile`, and
  the documented test/build flow.
- `packages/agent/package.json` and `packages/agent/README.md`: companion
  package is `@scout/agent@0.3.0`, exposes `scout-agent`, requires Node >=20,
  uses no runtime npm dependencies, and documents the real loopback endpoints.
- `packages/agent/src/*` and tests: current brief/chat generation shells out to
  the local `claude` CLI; tests assert no Anthropic API key is required and that
  the pairing token is not forwarded to `claude`.
- `AGENTS.md` / `CLAUDE.md`: contributor guidance correctly warns about the
  installed Next docs and documents the `pnpm test` guard for `packages/agent`
  and `/v0` behavior.

## Findings

### P1 - Root README names the wrong Next major

`README.md` says the stack is "Next.js 15 (App Router, static export)", while
`package.json` pins `next` and `eslint-config-next` to `16.2.6`.

Why it matters: contributors are explicitly warned that this repo's Next version
has breaking changes and must consult `node_modules/next/dist/docs/` before
writing code. The README should not point new contributors at the wrong major.

Suggested fix: update the stack line to "Next.js 16" or, better, "Next.js
16.2.x" so it stays close to `package.json`.

### P1 - `.env.example` contradicts current no-Anthropic/no-search-key onboarding

Root `README.md` says the client only needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and that Anthropic/web-search credentials are
not required anywhere in the repo because the local `claude` CLI owns auth.

`.env.example` still presents `ANTHROPIC_API_KEY`, `EXA_API_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` under "Secrets (Supabase Edge Functions only)" with
comments about Haiku/Opus model use and Exa search. That is stale for the main
developer onboarding path and conflicts with the companion's current contract
tests.

Why it matters: a new developer can reasonably infer they need paid Anthropic
and Exa keys to run Scout locally, even though the current loopback flow does
not require them.

Suggested fix: split the template into clearly required local app variables and
optional Supabase edge-function/admin variables, or remove the obsolete
Anthropic/Exa lines if those functions are no longer part of supported local
onboarding.

### P2 - `supabase/README.md` needs legacy/optional framing for Exa setup

`supabase/README.md` still documents `functions/exa-search/` and an
`EXA_API_KEY` deployment step as if that is part of the normal Scout v4 local
dev path. The current app code says the direct browser-to-Exa/Anthropic path was
removed in PER-109 and brief generation now goes through the local companion.

Why it matters: this doc is not necessarily wrong about files that still exist,
but it does not tell readers whether the Exa proxy is legacy, optional
shared-key infrastructure, or still required for any current supported flow.

Suggested fix: add a short status note at the top of `supabase/README.md`
explaining which Supabase pieces are required for the current GitHub Pages +
loopback companion setup, and whether `exa-search` is retained for legacy or
future use.

## Non-findings

- The root README's install flow is current for pnpm 11: `onlyBuiltDependencies`
  in `pnpm-workspace.yaml` covers native build approvals, and CI uses the same
  major.
- Companion install command in `packages/agent/README.md` matches
  `@scout/agent@0.3.0`; the Connect page derives the tarball version from the
  package metadata at build time.
- The AGENTS/CLAUDE test guidance matches `package.json`: `pnpm test` now runs
  the agent suite plus web tests. The instruction to run it before touching
  `packages/agent/src/*` or `/v0/*` behavior remains appropriate.
- No broken `CLAUDE.md` drift: it intentionally delegates to `AGENTS.md`.

## Recommended follow-up issues

1. Update the root README stack line from Next.js 15 to the currently pinned
   Next 16 version.
2. Refresh `.env.example` so local onboarding does not imply Anthropic or Exa
   keys are required.
3. Clarify `supabase/README.md` around current required setup versus retained
   optional/legacy Exa edge-function infrastructure.

## Verification

Static audit only; no application code changed and no build/test run was needed
for this docs findings artifact. Evidence came from `package.json`,
`packages/agent/package.json`, `.github/workflows/*.yml`, `next.config.ts`,
`.env.example`, `README.md`, `packages/agent/README.md`, `supabase/README.md`,
and targeted source/test references.
