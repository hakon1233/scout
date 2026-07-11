# Architecture & tech-debt review — 2026-06-26 (AIR-300)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this Quality Pass cycle (AIR-294…AIR-301,
all in progress under their owners) and are deliberately left to them.

**Baseline: 130 agent tests pass (`pnpm test`), suite hermetic/offline. `tsc
--noEmit` clean, lint 0 errors (2 pre-existing `<img>` warnings in `FeedView`,
untouched), `prettier --check` clean on touched files. One small clearly-safe
fix made directly (below); tree left green.**

## Overall read

The codebase remains healthy. The `@scout/agent` companion ↔ Next.js web split
holds; ten prior architecture passes (AIR-188, CAR-132, AIR-206, AIR-204,
AIR-220, AIR-232, AIR-245, AIR-257, AIR-270, AIR-286) have swept the agent engine,
the web glue (`companion.ts`) and the device-local persistence layer, and filed a
well-shaped backlog of the remaining structural debt.

Those prior passes were agent- and lib-focused. This pass swept the **web-side
presentation duplication the prior passes touched least** — the hand-rolled
date formatters scattered across the feed/brief/profile components — looking for
a leaky abstraction. It found one, and it was a clearly-safe direct fix.

## Finding — fixed directly this pass (small, reversible)

**The canonical "MMM d, yyyy" date formatter lived inside a component file
(`FeedView.tsx`) and was hand-copied into two sibling components, one of which
literally documented the copy as something to keep in sync by hand.**

`FeedView.tsx` owned the only timezone-safe date formatter in the app —
`formatDate(iso)`, which carefully builds a `Date` from local parts when the
input is a date-only `YYYY-MM-DD` string (per-story publish dates), because
`new Date("2026-06-20")` parses as **UTC midnight** and `toLocaleDateString`
then renders the *day before* for any reader west of UTC. It was already
exported and reused by the liked-stories page (`src/app/app/liked/page.tsx`).

Two other components re-implemented the same `{month:short, day:numeric,
year:numeric}` format inline against `Brief.generatedAt`, **without** that
timezone-safe handling:

- `src/components/BriefLayout.tsx:34` — inline `new Date(...).toLocaleDateString(...)`.
- `src/components/BriefHistory.tsx:186` — `formatBriefDate(b)`, whose comment
  read *"Mirrors BriefLayout's header date format"* — an explicit
  keep-two-copies-in-sync-by-hand coupling.

Today these two only ever receive **full ISO timestamps** (`generatedAt` is a
server `toISOString()`), so they are not currently buggy — the timezone-safe
branch only matters for date-only inputs, which only flow through `FeedView`.
But the formatter being **siloed inside a component file** is the structural
smell: the one place that knows the UTC-midnight gotcha can't protect the copies
that forgot it, and the next developer who points one of these formatters at a
date-only field (or copies the pattern again) silently reintroduces the
off-by-one — exactly the "small refactor now prevents a big one later" case.

**Fix (committed):**
1. Lifted the formatter verbatim into a new pure module
   `src/lib/format-date.ts` exporting `formatDate(iso)` (logic and the
   UTC-midnight comment unchanged).
2. `FeedView.tsx` now imports it and **re-exports** `formatDate`, so the
   existing `@/components/FeedView` importer (`liked/page.tsx`) is unchanged —
   zero blast radius for callers.
3. `BriefLayout.tsx` and `BriefHistory.tsx` now call the shared `formatDate`.
   For their full-ISO inputs the output is byte-identical (same options, the
   date-only branch can't trigger), so this is behavior-preserving; it collapses
   the documented hand-mirror into a single real dependency and gives both the
   timezone-safe handling for free.

Verification: `tsc --noEmit` + `eslint` + `prettier --check` clean on the four
touched files; `pnpm test` 130/130. The web components have no automated test
(the known AIR-129 gap), so behavior-preservation here rests on the move being a
verbatim extraction with identical formatter options and full-ISO inputs —
confirmed by reading.

## Considered and deliberately left (NOT filed — too small / not clearly-safe)

- `src/components/profile/InterestScopeView.tsx:67` and
  `InterestDocCard.tsx:29` each keep a local `formatDocDate(iso?)`. They are
  **not** clearly-safe to fold into the shared `formatDate`: they return `""`
  (not the echoed input) for empty/unparseable values, and `InterestDocCard`
  intentionally omits the year. Folding them would need a small options-bearing
  API and a deliberate empty-string decision — genuinely a judgment call, not a
  mechanical dedup, and very low value (no bug, full-ISO inputs). Recorded here
  rather than added as backlog noise; a future pass can fold them if a shared
  date module grows an options surface.

## Verified already-tracked — deliberately NOT re-filed

Confirmed still open and genuinely Scout-relevant this pass:

- **AIR-195** (high) — confirm-delete/rewrite TOCTOU vs. an in-flight chat turn.
- **AIR-196** — `readChatTranscript` blanket `catch { return [] }` wipes history.
- **AIR-197** — `server.ts` route-table / `withAuthedJson` refactor.
- **AIR-198** — shared `spawnClaude()` + chat per-session timeout + stdout cap.
- **AIR-177** — `/v0` 500 handler leaks `String(err)` to the client.
- **AIR-178** — unbounded chat transcript growth / whole-file poll read.
- **AIR-129** — no frontend test harness over the pure web seams (the gap that
  leaves this very fix unguarded by a test).
- **AIR-179** — observability on best-effort cleanup catches.
- **AIR-272** — cross-package contract test pinning the web story-date parser to
  the agent's canonical token (filed by AIR-270).
- **CAR-132 A/B/C** — server body-parse dedup, fire-and-forget observability,
  shared browser SSR-guard / abortable-effect hooks.

Note: **AIR-128** (the prior "dedup shortDate()/mapStatus()" tracker) is
**cancelled** — it targeted the retired rental-pricing product
(`DigestCard`/`CompetitorDetailPage`), so the Scout-side date-formatter
duplication this pass addressed was genuinely untracked. AIR-97/98/99 are
likewise retired-product issues (per AIR-193) and not treated as live Scout
trackers.

## Method

Grepped the tree for `toLocaleDateString` / `new Date(` across `src/`; found six
hand-rolled date formatters; traced each formatter's input source to determine
which receive date-only vs full-ISO strings (only `FeedView` receives date-only,
and it alone is timezone-safe); confirmed `BriefLayout`/`BriefHistory` are
byte-identical-output dedup targets and `InterestScopeView`/`InterestDocCard` are
not; confirmed AIR-128 (the would-be tracker) is cancelled/retired-product.
Extracted the shared module, routed the two safe call sites through it, kept the
public `@/components/FeedView` export stable. Ran `tsc --noEmit` + `eslint` +
`prettier --check` (touched files) + `pnpm test` (130/130 green).
