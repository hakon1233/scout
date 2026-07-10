# AIR-450 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-06-27._

## TL;DR

The `@scout/agent` companion ↔ Next.js web split remains structurally sound.
This is the **14th** architecture pass. The tree is **unchanged since the AIR-432
pass** (HEAD is exactly the AIR-432 fix commit `b06399f`), so the standing
structural debt is already comprehensively tracked by a well-shaped open backlog.

A scoped, backlog-filtered re-scan surfaced **no genuinely net-new, clearly-safe,
reversible in-pass code fix** — every code-smell candidate maps to an already-open
issue or a deliberate prior tradeoff. The one genuinely **untracked** gap
(flagged but never filed across the prior 13 passes) is **zero unit coverage for
the correctness-critical pure helpers in `src/lib`**. That is too large to land
in-pass safely (it needs a new unit harness), so it was filed as a **small,
reversible, tracer-bullet fix-issue** rather than re-litigated or rushed.

**Tree left green: `tsc --noEmit` clean, `pnpm test` 142/142 (hermetic/offline).
No source code changed this pass — only this findings doc was added.**

## Scan performed

- Sized every module (`wc -l`); confirmed tree unchanged since AIR-432.
- Grepped both `packages/agent/src` and `src` for fresh smells:
  - `TODO/FIXME/HACK/XXX` → **none**.
  - bare `catch {}` → all pre-existing best-effort paths reviewed in prior passes
    or intentional (e.g. `connect/page.tsx:161` poll loop "ignore transient,
    keep polling"; `interest-docs.ts:98` read-only fallback to local settings).
  - `String(err)` surfaces → tracked (AIR-177, the `/v0` 500 body leak) or
    intentional local-only diagnostics (`connect/page.tsx:132` is a
    127.0.0.1-only setup page, not a public surface).
  - `as any` → **zero real usages** (the two hits are inside comments).
  - `@ts-ignore` / `@ts-expect-error` → **none**; `eslint-disable` lines are all
    the documented `react-hooks/*` URL→state-hydration exceptions.
- Verified the `readErrorBody` error-body dedup (errors.ts) is **complete and
  consistent**: all 10 error-body parse sites across `chat.ts` / `companion.ts`
  use it; remaining `await res.json()` calls are success-path parses, not
  duplication.

## Filed this pass (small, reversible, net-new)

### N1 — No unit coverage for correctness-critical `src/lib` pure helpers → filed

- **Gap:** `pnpm test` runs only the hermetic `@scout/agent` suite (142 tests,
  `packages/agent`). The web app has a Playwright **e2e** harness (`test:e2e`)
  but **no unit harness** — `git ls-files` finds zero `src/**/*.test.*`. So the
  pure, branch-heavy helpers in `src/lib` have **no fast unit coverage**, despite
  gating real correctness:
  - `interest-docs.ts#interestKey` — derives the key a chat change's
    `interestId` is matched against to apply an edit to the right card. A silent
    drift here mis-targets edits with no error.
  - `errors.ts#classifyError` — drives every error-UI branch
    (auth / rate_limit / network / unknown) and the retry-after surface.
  - `format-date.ts`, `chat-diff.ts` — pure formatting/diff logic.
- **Why net-new, not a re-file:** the hermetic-suite issues cover
  `packages/agent`; no open `todo` issue tracks web-side unit coverage. The prior
  13 passes flagged this as the one untracked gap but never filed it.
- **Why not landed in-pass:** it requires adding a unit test runner for the Next
  app (vitest) + wiring — larger than a clearly-safe in-pass edit, and rushing a
  harness risks CI churn. Filed as a tracer-bullet: minimal `vitest` config +
  unit tests for the 3–4 highest-risk pure helpers first, expandable later.

## Already tracked — confirmed open, NOT re-filed

| Issue | Item |
|---|---|
| AIR-197 | Extract route table + `withAuthedJson` from the 1,122-line `server.ts` |
| AIR-198 | Shared `spawnClaude()` + chat per-session timeout |
| AIR-195 | Chat confirm-delete/rewrite TOCTOU vs. in-flight turn |
| AIR-196 | `readChatTranscript` corrupt-read handling |
| AIR-177 | `/v0` 500 handler leaks `String(err)` to client (`server.ts:1105`) |
| AIR-178 | Cap chat transcript growth (last-N) |
| AIR-374 | `POST /v0/weekly-brief` bypasses single-flight, clobbers brief slot |
| AIR-375 | Decompose `AppPage` god-component |
| AIR-376 | Extract + unit-test brief-markdown parser out of `companion.ts` |
| AIR-272 | Pin web↔agent wire contract via contract test (type-shape dup) |
| AIR-356 N1/N2 | Scattered client fetch timeouts; structured logging / correlation IDs |
| AIR-437/439/440 | Web error-handling gaps (BriefHistory / chat send / global-error copy) |
| AIR-435/442/407/405/408 | a11y + hydration correctness |

## Verification

- No paid Apify scrape was run (no Apify integration exists in the repo; scraping
  is delegated to the `claude` CLI's WebSearch/WebFetch — the hard-guardrail flow
  is not reachable here).
- No secrets read or exfiltrated.
- Open backlog checked via the Paperclip issue API before deciding not to re-file.
- `pnpm test` 142/142, `tsc --noEmit` clean. No source changed — only this doc.

## Method

CAM tools (`read_inheritance_context` / `append_work_log_entry`) were **not
registered** this run (ToolSearch returned no matches); reconstructed prior
context from `docs/air-432-architecture-findings.md`,
`docs/air-417-architecture-findings.md`, and the live open-issue backlog
(read via a subagent over the full issue dump). Work-log written via the
documented comment fallback (`<!-- cross-attempt-memory:work-log -->`).
