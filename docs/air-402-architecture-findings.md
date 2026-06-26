# AIR-402 - Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-06-26._

## Summary

The `@scout/agent` companion and the Next.js web app remain structurally sound.
This pass found no new small code change that cleared all three bars:

- clearly architecture / tech-debt, not a sibling quality lane;
- safer to fix directly than to file;
- not already tracked by the open architecture backlog.

The immediately preceding architecture pass, AIR-388, already landed the one
fresh low-risk improvement in this area: `packages/agent/src/runner.ts` now logs
per-topic research failures instead of swallowing them with a bare `catch {}`.
That fix is on `main` as `47a01b7` with `docs/air-388-architecture-findings.md`.
AIR-402 deliberately did not manufacture another code change from lower-value
smells.

## Prioritized Findings

### P1 - Continue the existing agent-server decomposition backlog

**Status:** already tracked, not re-filed.

The biggest remaining architecture leverage is still concentrated in the open
agent companion backlog:

- AIR-197: extract a route table plus `withAuthedJson` from `server.ts`.
- AIR-198: extract shared `spawnClaude()` and add chat per-session timeout.
- AIR-177: stop leaking `String(err)` from `/v0` 500 responses.
- AIR-178: cap chat transcript growth.
- AIR-196: harden corrupt transcript handling.
- AIR-195: close chat confirm-delete/rewrite race with an in-flight turn.
- AIR-374: make `POST /v0/weekly-brief` respect the single-flight brief slot.

These are the right next fixes because they improve locality around request
handling, subprocess lifecycle, and persistent chat state. They are too large
for this recurring pass to land safely as drive-by work, but they are already
small reversible backlog issues.

### P2 - Keep web-companion drift pinned by contract tests, not a shared package

**Status:** already tracked by AIR-272.

The web app intentionally mirrors some companion wire shapes rather than
importing the agent package. Prior passes chose a contract-test seam over a
shared-types package because the web static export and npm companion are
separately shipped. AIR-272 remains the right home for this. Re-filing "extract
shared types" would re-litigate a deliberate tradeoff without new evidence.

### P3 - Timeout and observability cleanup belongs in backlog work

**Status:** already tracked by AIR-362 and AIR-363.

`src/lib/companion.ts`, `src/lib/chat.ts`, and related client helpers still carry
several inline `AbortSignal.timeout(...)` values. The issue is real, but it is a
cross-file cleanup that should land under the existing timeout-constants and
correlation-ID issues rather than as an unreviewable architecture-pass sweep.

## Considered, Not Changed

- `packages/agent/src/weekly.ts` and `src/lib/likes.ts` still mirror
  `canonicalUrl()`. Prior passes already recorded why this is not a simple shared
  import: the web app should not depend on the separately published agent
  package. Leave it unless a shared web-agent utility package is introduced for
  another reason.
- `packages/agent/src/coverage.ts` is dense, but its pure functions carry strong
  test coverage and well-documented invariants. Splitting it today would likely
  reduce locality: the parsing, freshness filtering, and merge behavior are one
  cohesive assembly module.
- `packages/agent/src/service.ts` has best-effort `launchctl` fallbacks that
  intentionally swallow cleanup/status failures. That is appropriate for the CLI
  install/status surface and is covered by pure plist tests.

## Verification

- No paid Apify scrape was run.
- No secrets were read or exfiltrated.
- Open architecture backlog was checked through the Paperclip issue API before
  deciding not to file duplicates.
- `pnpm test` passed: 142/142 agent tests.
- `pnpm run typecheck` passed.
- `pnpm exec eslint packages/agent/src/runner.ts` passed. The docs file is
  ignored by the current eslint config.
