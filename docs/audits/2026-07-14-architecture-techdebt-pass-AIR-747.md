# AIR-747 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-07-14. Audited at `main` HEAD
`607810d`. Source has been near-frozen since the AIR-732 pass — the only new
source commit is `72c4e8e` (blank-brief pagination default). This pass's change
lands on top._

## TL;DR

Scout's `@scout/agent` companion ↔ static Next.js web split remains structurally
sound — this is the ~20th architecture pass on a **very well-tended** codebase,
the fifth of 2026-07-14 (AIR-705 → AIR-718 → AIR-732 → this). Rather than re-run
the identical scan and manufacture a finding, this pass **independently
re-scanned the debt surfaces**, **closed one real observability gap** the AIR-626
transport-logging work left behind, and **re-verified all standing tracking** —
every standing item is still tracked by an open issue.

**Landed 1 clearly-safe code change** (`src/app/app/connect/page.tsx` +
`src/lib/companion.ts`): the onboarding first-brief poll was the one
browser→loopback **read** path whose transport failures produced **zero** console
signal — the exact "went dark, undiagnosable" case AIR-626 fixed for the other
four read paths, but this one lives in a different file and was never wired in.
Now it logs via the shared `logCompanionError` helper, **first-failure-only** so
the tight poll loop doesn't spam. Zero control-flow change (still swallows and
keeps polling).

**Filed no net-new fix-issues** — the independent scan surfaced nothing else
un-tracked; every standing item maps to an already-open issue. On the
shared-`spawnClaude` extraction: it **is** still open as **AIR-198** (backlog) —
the prior AIR-732 doc's reference was correct. A later _duplicate_, **AIR-661**,
was cancelled. Do not re-file — AIR-198 owns it.

**Tree left green:** `tsc --noEmit` clean · `pnpm lint` 0 problems · top-level
**2/2** · `@scout/agent` **161/161** · `test:web` **58/58**.

## Method

1. Confirmed source near-frozen: `git diff ba05843 HEAD` (the AIR-732 audit base)
   shows only the AIR-732 doc-comment breadcrumb + the `72c4e8e` blank-pagination
   fix (clean, well-tested) + docs. Working tree clean at start.
2. Independent debt scan (not trusting the prior doc):
   - **TODO/FIXME/HACK/XXX markers:** zero across `src` + `packages/agent/src`.
   - **`eslint-disable` inventory:** 17, all the catalogued mount-hydration /
     intentional-favicon disables. Nothing new.
   - **Type escape hatches:** no `@ts-ignore`; `@ts-expect-error` only in test
     env-restoration; no new runtime casts.
   - **Empty `catch {}` swallows:** enumerated every catch in `src` +
     `packages/agent/src`. All are UI-level handled (set error state / render a
     banner) **except** the onboarding poll's `catch {}` — see below.
3. **Observability focus** (the issue's explicit ask). Re-walked every
   browser→loopback fetch path in `companion.ts` against the AIR-626 policy: the
   silent-degrade **read** paths (`config-fetch`, `latest-brief-fetch`,
   `run-failure-fetch`, `brief-history-fetch`) all log; the **throw** paths
   (`fetchSchedule`, `updateSchedule`, `generateWeeklyBrief`,
   `refreshBriefViaCompanion`) surface real errors to callers. Consistent — with
   one exception in a *different* file (the fix below).
4. Re-verified every standing-findings issue via the tracker (below).

## Landed this pass — onboarding-poll observability (AIR-626 parity)

`handleGenerate` in `connect/page.tsx` kicks a research run, then polls
`pollBriefs` every 4s until a brief lands or the attempt budget times out. The
catch was `catch {}` — "ignore transient errors, keep polling." That's correct
for control flow, but it means a **persistently-dark transport during onboarding**
(companion crashed after pairing → `fetch` rejects → propagates up through
`pollBriefsRaw` → `pollBriefs`) produced **nothing** in the console: the user saw
only the eventual "Timed out… check the companion terminal," and a developer
diagnosing it had no `[companion]` signal to key off. This is the identical class
of gap AIR-626 closed for the four read helpers — the poll simply lived in a page
component, outside the `companion.ts` helpers AIR-626 touched.

**Why it's genuinely unexpected (not an expected-negative like discovery):** this
poll only runs after pairing is confirmed and a run was just POSTed, and
`pollBriefsRaw` returns `[]` (not a throw) for the normal "not ready yet" state —
so the catch only fires on a *real* transport/parse failure, never on routine
polling. Logging it is signal, not noise.

**Change:** exported the existing `logCompanionError` helper (its whole purpose is
a single stable `[companion]` prefix across the transport surface) and call it
from the poll catch, guarded by a `pollErrorLoggedRef` so it logs **once per
polling session** — the poll fires every few seconds, so an unguarded log would
spam identical lines the whole time the companion is dark. Control flow is
unchanged (still swallows, still keeps polling until the existing timeout).

Verified green (typecheck / lint / all suites). This completes the AIR-626
observability story; no follow-up issue needed.

## Standing findings — current state (re-verified via tracker this pass; do NOT re-file)

| Item | Issue | State (verified this pass) |
|---|---|---|
| Extract shared `spawnClaude()` (chat.ts has no per-session timeout, wedges the chat slot) | AIR-198 | **backlog** (prior doc's ref was correct; a later duplicate AIR-661 was cancelled) |
| Decompose `AppPage` god-component | AIR-375 | **backlog** |
| Extract + test brief-markdown parser out of `companion.ts` | AIR-376 | **backlog** |
| Decompose agent `chat.ts` — pure prompt-builder seam first | AIR-625 | **backlog** |
| `POST /v0/weekly-brief` clobbers single last-writer-wins brief slot | AIR-374 | **backlog** |
| `state.json` lost-update race (mutating route clobbers a run's write) | AIR-537 | **backlog** |
| `readBody` destroys socket before the 413 is written (ECONNRESET not 413) | AIR-640 | **backlog** (breadcrumbed by AIR-732) |
| Agent chat confirm-delete/rewrite races an in-flight model turn | AIR-195 | **backlog** |
| `companion.ts` transport swallowed failures silently | AIR-626 | **done** ✅ |
| Brief-history pager shows "No previous briefs" on a *failed* load (UX truth) | AIR-330 | **backlog** — related to this area but a distinct user-facing concern, not the console gap fixed here |

## Watch items (documented, no action needed now)

- **Two ~1000-LOC modules concentrate churn:** agent `chat.ts` (1046) and
  `companion.ts` (951). Decomposition tracked (AIR-625 / AIR-375 / AIR-376);
  neither urgent.
- **Write-race family on `state.json`:** narrow instances tracked (AIR-195,
  AIR-374, general form AIR-537). Single-process global mutable state remains the
  failure mode to watch as the app grows. All tracked.
- **Web↔agent wire types are hand-copied** (`AgentBrief`, chat wire types, brief
  markdown) and have drifted before. Partially anchored by AIR-376. A
  `@scout/shared` shape module would dissolve it but is a multi-file seam, not a
  solo-pass fix.
- **`spawnClaude` dedup remains tracked by AIR-198 (backlog).** The duplication
  between `chat.ts` and `research.ts` still exists; AIR-198 frames it around
  `chat.ts`'s missing per-session timeout (the higher-value angle). A later
  generic duplicate, AIR-661, was cancelled. Do **not** open a fresh issue —
  AIR-198 owns this. (Note for future passes: AIR-198 was absent from one scoped
  `ListIssues` dump during this pass; verify issue state positively via
  `GetIssue`/relatedWork rather than inferring "closed" from a list's absence.)
- **Wrong-repo backlog:** the "deep-audit airbnb-assistant" issues reference a
  *different* product's files absent from this `scout` repo. Already flagged
  (AIR-673, blocked). Not an architecture item.

## Assessment

The architecture is in good shape and prior passes have worked the structural debt
down thoroughly and tracked it accurately. Source is near-frozen, so there was no
large structural move to make. The highest-integrity work this pass was to (a)
close the one *real* remaining hole in the AIR-626 observability net — a
clearly-safe, bounded, reversible log addition directly in the issue's stated
scope ("missing error handling/observability") — and (b) keep the tracking honest,
confirming the `spawnClaude` extraction is still open (AIR-198, backlog) and its
later duplicate (AIR-661) correctly cancelled. The remaining tracked items are all
larger own-issue refactors (AIR-375 / AIR-625 / AIR-376) or behavior-changing bug
fixes needing test rigor (AIR-374 / AIR-537 / AIR-640 / AIR-195 / AIR-330),
correctly deferred to the eng loop and inappropriate as drive-by review-pass edits.
