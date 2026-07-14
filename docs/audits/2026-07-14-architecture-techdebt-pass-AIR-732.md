# AIR-732 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-07-14. Audited at `main` HEAD
`ba05843`; source frozen since the AIR-626 fix `708e419` — only the AIR-718 docs
commit has landed since. This pass's change lands on top._

## TL;DR

Scout's `@scout/agent` companion ↔ static Next.js web split remains structurally
sound. This is the ~19th architecture pass on a **very well-tended** codebase,
and the fourth architecture pass of 2026-07-14 (AIR-705 → AIR-718 → this). Source
is again **frozen** — `git diff 708e419 HEAD -- . ':(exclude)docs/**'` is empty and
the working tree was clean at start — so rather than re-run the identical scan and
manufacture a finding, this pass **independently re-scanned the debt surfaces**,
**re-verified all standing tracking is still open**, and landed **one clearly-safe,
comment-only correction** where an existing comment had drifted from the truth.

**Landed 1 doc-only change** (`packages/agent/src/http-util.ts`): an accurate
`CAVEAT (AIR-640)` breadcrumb at the `readBody` `req.destroy()` site, which
previously read as if the teardown were unconditionally correct. **Filed no
net-new fix-issues** — the independent scan surfaced nothing un-tracked; every
standing item maps to an already-open issue, all re-confirmed **backlog**.

**Tree left green:** `tsc --noEmit` clean · `pnpm lint` 0 problems ·
`@scout/agent` **161/161** · `test:web` **58/58**.

## Method

1. Confirmed source frozen since AIR-626 (`git diff 708e419 HEAD -- . ':(exclude)docs/**'`
   → empty; working tree clean at start).
2. Independent debt scan (not trusting the prior doc):
   - **TODO/FIXME/HACK/XXX markers:** zero across `src` + `packages/agent/src`.
   - **`eslint-disable` inventory:** all 17 are the catalogued
     `react-hooks/set-state-in-effect` mount-hydration pattern (AIR-619 item,
     deliberately unfiled — heterogeneous effects, no clean single hook) or the
     intentional, individually-commented `@next/next/no-img-element` favicon
     disables. Nothing new.
   - **Type escape hatches:** no `@ts-ignore`; the `@ts-expect-error` hits are all
     test-env restoration in `*.test.ts`; the only runtime `as unknown` is a legit
     `(raw as unknown[])` array-narrow in `routes/interests.ts`. The `as any`
     grep hits are all inside *comments* ("flash as any other update"), not casts.
   - **Empty `catch {}` swallows:** same known set as prior passes; the browser
     transport swallows in `companion.ts` were retired last pass (AIR-626).
3. "New debt is likeliest on the freshest surface" — re-read the two most recent
   *source* commits' files (`storage.ts` malformed-brief guard `27cc55c`,
   `companion.ts` transport logging `708e419`). Both clean and well-documented.
4. Re-verified every standing-findings issue is still genuinely open (below).

## Landed this pass — AIR-640 breadcrumb (http-util.ts, doc-only)

The `readBody` size-guard tears the socket down with `req.destroy()` on overflow,
then throws `BodyTooLargeError` so the caller can answer 413. The existing comment
explained only the *memory* rationale ("so we never hold the whole oversized
payload in memory") — which reads as if the teardown were unconditionally correct.
It is not: `req.destroy()` also kills the **shared** socket, so on the streaming
path (chunked / absent / under-declared `content-length`) the caller's 413 can
never reach the client, which sees an `ECONNRESET` instead. This is the exact
response-correctness bug tracked by **AIR-640** (still backlog), and the site is a
classic "looks-correct-in-isolation" trap: a future maintainer reading only the
memory comment could easily bless the line without knowing the caveat.

**Change:** extended the inline comment into an accurate `CAVEAT (AIR-640)`
breadcrumb naming the ECONNRESET-instead-of-413 behavior, noting memory protection
is intact, and recording that an *accurately-declared* oversized body is
fast-rejected with a clean 413 by `parseJsonBody` before `readBody` ever runs.
Zero behavior change (comment only); house style already references issue IDs in
comments throughout. This makes the drifted invariant read as a *known, tracked
limitation* rather than an oversight — without pre-empting the real fix, which is
behavior-changing (socket lifecycle) and correctly deferred to its own issue.

Verified green (typecheck / lint / `@scout/agent` 161/161 incl. the PER-137
oversized-body 413 test / `test:web` 58/58). AIR-640 remains open.

## Standing findings — current state (all re-verified OPEN this pass; do NOT re-file)

| Item | Issue | State (verified this pass) |
|---|---|---|
| Extract shared `spawnClaude()` (research/chat spawn dup; timeout drift) | AIR-198 | **backlog** (timeout fixed via AIR-540; the shared-helper extraction remains) |
| Decompose `AppPage` god-component (727 LOC) | AIR-375 | **backlog** |
| Extract + test brief-markdown parser out of `companion.ts` | AIR-376 | **backlog** |
| Decompose agent `chat.ts` (1046 LOC) — pure prompt-builder seam first | AIR-625 | **backlog** |
| `POST /v0/weekly-brief` clobbers single last-writer-wins brief slot | AIR-374 | **backlog** |
| `state.json` lost-update race (router-snapshot save clobbers a run's write) | AIR-537 | **backlog** |
| `readBody` destroys socket before the 413 is written (ECONNRESET not 413) | AIR-640 | **backlog** (breadcrumbed this pass) |
| `companion.ts` transport swallowed failures silently | AIR-626 | **done** (AIR-718) ✅ |

## Watch items (documented, no action needed now)

- **Two ~1000-LOC modules concentrate churn:** agent `chat.ts` (1046) and
  `companion.ts` (951, +27 from the AIR-626 logging). Decomposition tracked
  (AIR-625 / AIR-375 / AIR-376); neither urgent.
- **Write-race family on `state.json`:** three narrow instances tracked — AIR-195
  (chat confirm vs turn), AIR-374 (weekly-brief vs single-flight), and the general
  form AIR-537 (router-snapshot save vs run write). The single-process global
  mutable state remains the failure mode to watch as the app grows. All tracked.
- **Web↔agent wire types are hand-copied** (`AgentBrief`, chat wire types, brief
  markdown) and have drifted before. Partially anchored by AIR-376. A
  `@scout/shared` shape module would dissolve it but is a multi-file seam, not a
  solo-pass fix.
- **Wrong-repo backlog:** the "deep-audit airbnb-assistant" issues reference a
  *different* product's files absent from this `scout` repo. Already flagged
  (AIR-673, blocked). Not an architecture item.

## Assessment

The architecture is in good shape and prior passes have worked the structural debt
down thoroughly and tracked it accurately. With source frozen and the last scoped
additive fix (AIR-626) already retired, there was **no new clearly-safe code
improvement to make and nothing un-tracked to file** — manufacturing either would
be make-work. The highest-integrity move was to verify the tracking holds, confirm
the fresh surfaces are clean, and correct the one *misleading* artifact I found: a
comment that hid a known, tracked limitation. The remaining tracked items are all
larger own-issue refactors (AIR-375 / AIR-625 / AIR-376 / AIR-198) or
behavior-changing bug fixes needing test rigor (AIR-374 / AIR-537 / AIR-640),
correctly deferred to the eng loop and inappropriate as drive-by review-pass edits.
