# Architecture & Tech-Debt Review — 2026-06-25 (CAR-155)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
module tangling, leaky abstractions, duplicated logic, risky patterns, missing
error-handling/observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this same Quality Pass (CAR-148) and are
deliberately left to them.

Baseline before this pass: **128 agent tests pass, typecheck clean, 0 lint
errors** (27 pre-existing `<img>` warnings). All still green after the changes
below.

## Context — most structural debt is already tracked

Two prior architecture passes this cycle already filed the high-value items, and
re-filing them is explicitly out of scope:

- **CAR-132** (`docs/architecture-review-2026-06-25.md`): A — `server.ts`
  request-body + `ChatDeps` dedup; B — server-side observability for
  fire-and-forget errors; C — shared browser hooks (SSR-guard +
  AbortController).
- **AIR-188** (`docs/air-188-architecture-findings.md`): H1 — confirm-path
  TOCTOU race; H2 — read-side transcript hardening; M3 — `server.ts` route-table
  refactor; M4 — shared `spawnClaude()` + missing chat timeout.

This pass therefore focused on the **explicitly-noted-but-unfixed** low-risk
items from those docs — the small, clearly-safe seams that move the needle now
without opening yet another tracking issue.

## Fixed directly this pass (small, clearly-safe, behavior-preserving)

1. **`weekly.ts` `LINK_RE` footgun (AIR-188 L3).** The link-extraction regex was
   module-level with the `/g` flag, which carries `lastIndex` state across calls
   and forced a manual `LINK_RE.lastIndex = 0` reset before every `.exec`.
   `storyUrl` only ever needs the first match, so the global flag bought nothing
   and one forgotten reset would silently skip a story's URL. Dropped `/g`
   (regex is now stateless) and removed the reset line. (`packages/agent/src/weekly.ts`)

2. **`scheduler.ts nextFireAt` time-format divergence (AIR-188 L1).** `nextFireAt`
   required a strict 2-digit `HH:MM`, while `state.ts normalizeTimeOfDay` accepts
   and canonicalizes a 1-digit hour (`"7:00"` → `"07:00"`). A single-digit value
   reaching `nextFireAt` from any path that skipped normalization returned `null`
   and **silently disabled the schedule**. Relaxed the hour group to `\d{1,2}` so
   the two validators agree. Existing 2-digit inputs parse identically; only the
   previously-rejected 1-digit form is newly accepted. (`packages/agent/src/scheduler.ts`)

## Reviewed and deliberately NOT changed / filed

- **AIR-188 L5 — `GET /v0/briefs` ignores `since` when `limit`/`offset` present.**
  On inspection this is **documented intentional** behavior (PER-219): `limit`/`offset`
  select the paginated history view, absence of both selects the legacy
  `since`-filtered latest-slot poller. The UI uses one mode or the other; the
  `since`+`limit` combo is not a real call shape. No change — re-filing would be noise.
- **AIR-188 M5 — raw `String(err)` persisted/served** in `runner.ts` / `chat.ts`:
  same error-leak class as AIR-177; left folded into AIR-177's scope as noted, not
  re-filed.
- Larger structural items (server.ts route-table, spawnClaude dedup, browser-hook
  extraction, TOCTOU race, transcript read hardening) — already tracked by
  CAR-132 / AIR-188 above. Not re-filed.

## Net

Two single-line-class footguns removed at the source; no new tracking issues
needed this cycle. Build/lint/test green.
