# AIR-417 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-06-26._

## TL;DR

The `@scout/agent` companion ↔ Next.js web split remains structurally sound.
This is the 12th+ architecture pass; the code is **unchanged since the AIR-402
pass earlier today** (HEAD was exactly the AIR-402 doc commit `20bf4e0`), so the
structural debt is already comprehensively tracked by a well-shaped open backlog.

A focused, scoped re-scan (deliberately filtered against the known backlog to
avoid re-litigating tracked items) surfaced **one genuinely net-new,
clearly-safe, reversible fix**, which was **landed in-pass**: an unhandled-
rejection / process-crash gap on the scheduler's only fully-automatic code path.
No new issues filed — every other candidate maps to an already-open issue.

**Tree left green: `tsc --noEmit` clean, `eslint` clean, `prettier --check`
clean, `pnpm test` 142/142 (hermetic/offline).**

## Fixed in this pass (small, clearly-safe, reversible)

### F1 — `scheduler.ts` timer dispatch swallowed scheduled-fire failures ✅ FIXED

- **File:** `packages/agent/src/scheduler.ts:105`.
- **Problem:** The recurring daily schedule armed its next fire with
  `setTimeout(() => void this.fire(), delay)` — **no `.catch()`**. `fire()` is
  `async` and does real disk I/O (`reschedule()` → `loadState`/`saveState`,
  then `loadState`, `startRun`, `recordScheduledSkip`). If any of those throws
  (disk error, corrupt state, etc.), the `void this.fire()` becomes an
  **unhandled promise rejection** — a process-crash risk under Node's default
  rejection handling, and **totally silent**: the founder's scheduled brief just
  never runs, with zero stderr signal.
- **Why it was invisible:** This is the **only fully-automatic** path into
  `fire()`. Every unit test invokes `fire()` **directly and awaited**, so test
  failures surface there — the timer-dispatched path (the one that runs in
  production) had no coverage of the throw case and no logging.
- **Why net-new (not a re-file):** Distinct from the tracked observability items
  — AIR-179 (best-effort *cleanup* catches), AIR-388 F1 (the *research-loop*
  silent catch, already shipped), AIR-356 N2 (correlation IDs). This was the one
  remaining **unguarded automatic async dispatch** in the agent.
- **Fix:** Wrap the dispatched `fire()` with
  `.catch((err) => console.error("[scheduler] scheduled fire failed:", err))`.
  Control flow is **unchanged** (the next timer is already re-armed at the top of
  `fire()` before any throwing work, so a logged failure does not stop future
  fires) — purely additive observability + crash-safety, matching the existing
  `runner.ts:279` / `chat.ts:708` `void …().catch()` pattern.
- **Verification:** `tsc --noEmit`, `eslint`, `prettier --check` clean on
  `scheduler.ts`; `pnpm test` 142/142.

## Already tracked — confirmed open, NOT re-filed

The open backlog (verified via the Paperclip issue API this pass) still covers
the standing structural debt:

| Issue | Item |
|---|---|
| AIR-197 | Extract route table + `withAuthedJson` from the 1,119-line `server.ts` |
| AIR-198 | Shared `spawnClaude()` + chat per-session timeout |
| AIR-195 | Chat confirm-delete/rewrite TOCTOU vs. in-flight turn |
| AIR-196 | `readChatTranscript` corrupt-read wipes history |
| AIR-177 | `/v0` 500 handler leaks `String(err)` to client (`server.ts:1102`) |
| AIR-178 | Cap chat transcript growth (last-N) |
| AIR-374 | `POST /v0/weekly-brief` bypasses single-flight, clobbers brief slot |
| AIR-375 | Decompose `AppPage` god-component (useCompanionSync/useBriefRun) |
| AIR-376 | Extract + unit-test brief-markdown parser out of `companion.ts` |
| AIR-272 | Pin web↔agent wire contract via contract test (type-shape dup) |
| AIR-356 N1/N2 | Scattered client fetch timeouts; structured logging / correlation IDs |

## Considered, not changed

- Web↔agent type-shape duplication (`src/lib/chat.ts` / `types.ts` mirror
  `state.ts` / `coverage.ts`) and the `canonicalUrl()` mirror in
  `weekly.ts`/`likes.ts` — a prior pass deliberately chose the contract-test seam
  (AIR-272) over a shared-types package, since the web static export and npm
  companion ship separately. Not re-litigated.
- `coverage.ts` density and `service.ts` best-effort `launchctl` catches — both
  intentional, well-tested, well-documented; splitting/changing would reduce
  locality. Left as-is.

## Verification

- No paid Apify scrape was run (no Apify integration exists in the repo; scraping
  is delegated to the `claude` CLI's WebSearch/WebFetch — the hard-guardrail flow
  is not reachable here).
- No secrets were read or exfiltrated; the scheduler error log carries only the
  caught error, never the OAuth token (spawn never forwards it — PER-108 guard).
- Open backlog checked via the Paperclip issue API before deciding not to file
  duplicates.
- `pnpm test` 142/142, `tsc --noEmit` clean, `eslint` + `prettier --check` clean
  on the touched file.

## Method

`read_inheritance_context` / CAM tools were not registered this run;
reconstructed prior context from `docs/air-402-architecture-findings.md`,
`docs/air-388-architecture-findings.md`, and the live open-issue backlog. Sized
every module (`wc -l`), confirmed the tree was unchanged since AIR-402, fanned
out one scoped read-only review agent over the fat modules (filtered against the
tracked backlog to surface only net-new candidates), verified the one finding by
hand, applied the clearly-safe fix, and re-ran the full green-bar
(`tsc`/`eslint`/`prettier`/`pnpm test`).
