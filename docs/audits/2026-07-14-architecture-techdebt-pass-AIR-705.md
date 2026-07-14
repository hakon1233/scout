# AIR-705 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-07-14. Audited at `main` HEAD
`8afb3fd` (rebased before push); fix landed as `9473525`._

## TL;DR

Scout's `@scout/agent` companion ↔ static Next.js web split remains structurally
sound — this is the ~17th architecture pass on a **very well-tended** codebase.
The standing structural debt is comprehensively tracked. A full parallel
Quality-Pass batch (AIR-699–706: security, design, bug-hunt, QA-live, perf,
product-gap, docs) is sweeping this same repo concurrently, so this pass stayed
strictly in the architecture lane.

Method: read the two prior passes from today/this week (AIR-670, AIR-682, AIR-619,
AIR-635) to avoid re-treading, then a fresh scan of what the recent commits
(AIR-407 nav, AIR-668 perf, de773d1 connect, AIR-682 weekly) actually changed —
new debt is likeliest on the freshest surface. Every candidate was verified
against the tree and the open backlog before acting.

**Landed 1 small, clearly-safe, behavior-preserving fix directly** (commit
`9473525`): consolidated the two nav popovers' duplicated disclosure logic.
**Filed no net-new fix-issues** — everything else maps to an already-open issue,
and the one catalogued-but-unfiled candidate was re-examined and correctly
belongs unfiled (see below).

**Tree left green:** `tsc --noEmit` clean · `pnpm lint` 0 problems · `pnpm
test:web` 51/51.

## Landed this pass (commit `9473525`)

**Extracted a shared `useDisclosure()` hook in `AppNav.tsx`.** `FeedFilter` and
`ProfileMenu` each hand-implemented **byte-identical** disclosure-popover state:
the `open` flag, the `containerRef`/`buttonRef` pair, and the outside-click +
Escape-close-and-return-focus effect. The concrete drift cost was visible in the
history — **AIR-407** (which added Escape-returns-focus-to-trigger) had to
hand-edit *both* copies in lockstep. Hoisted that shared block into a single
local `useDisclosure()` hook returning `{ open, setOpen, containerRef,
buttonRef }`; both components consume it. FeedFilter's `menuStyle` positioning
`useLayoutEffect` stays local (only the open-state + listeners are shared — the
narrow interface). Net −14 lines, behavior-preserving, single-file, e2e-covered
(`feed-filter-*.spec.ts`). This was a live, un-tracked instance of exactly the
"small refactor now prevents a big one later" the pass targets.

## Filed this pass

None. See assessment.

## Re-examined and deliberately NOT filed / NOT fixed

- **`useHydratedState` mount-hydration hook** (catalogued by AIR-619 as "the
  strongest signal a shared hook is missing" — ~10 files carry an
  `eslint-disable react-hooks/set-state-in-effect` mount effect). Re-read the
  actual effects this pass: they are **heterogeneous** — a bare `setMounted(true)`
  flag (ThemeToggle), a `matchMedia` subscription (ChatDock), a
  URL→state + `popstate` listener (interests), a localStorage hydrate + hydrated
  flag (page.tsx), an async `load()` (ScheduleSettings), and a
  `window.location.origin` sync (connect). No single `useHydratedState(init)`
  cleanly subsumes these without a leaky over-parameterized signature. The prior
  CTO's instinct to leave it unfiled was correct; **confirmed, still not filed.**
  (The AppNav popovers above were the *opposite* case — genuinely byte-identical,
  same file — which is why that one got fixed.)

## Standing findings — current state (do NOT re-file)

| Item | Anchor | State |
|---|---|---|
| `spawnClaude()` dedup (chat.ts vs research.ts; chat had no timeout) | AIR-198 (open) / AIR-540 (done) | Chat timeout **fixed** (AIR-540); the shared-helper extraction remains tracked (AIR-198). AIR-661 was the duplicate and is **cancelled**. |
| Decompose `AppPage` god-component (727 LOC) | AIR-375 (open) | Tracked. |
| Extract + test the brief-markdown parser out of `companion.ts` | AIR-376 (open) | Tracked — also the live anchor for the "web↔agent wire contract has no shared home" theme (AIR-272 closed). |
| Decompose `chat.ts` (1046 LOC) — extract pure prompt builder first | AIR-625 (open) | Tracked. |
| `companion.ts` client swallows transport failures silently | AIR-626 (open) | Tracked. |
| `POST /v0/weekly-brief` clobbers single last-writer-wins brief slot | AIR-374 (open, enriched by AIR-635) | Tracked. |
| `state.json` lost-update race / reload-before-persist copied 4× | AIR-537 (open) | Tracked. |
| `readBody` resets socket instead of writing the 413 | AIR-640 (open) | Tracked. |
| Structured logger (44 raw `console.*` in agent) | (AIR-662 resolved) | Closed. |

## Watch items (documented, no action needed now)

- **Two ~1000-LOC modules still concentrate churn:** `companion.ts` (924) and
  `chat.ts` (1046). Decomposition tracked (AIR-625/375/376); neither urgent.
- **Web↔agent wire types are hand-copied** (`AgentBrief`, chat wire types, the
  brief-markdown format) and have drifted before. Partially anchored by AIR-376.
  A `@scout/shared` shape module would dissolve it but is a multi-file seam, not a
  solo clearly-safe pass fix.
- **Single-process global mutable state** (`chatInFlight`, unsynchronized
  `state.json` R-M-W) remains the failure mode to watch as the app grows.
  Tracked (AIR-537).
- **Wrong-repo backlog:** the ~40 "deep-audit airbnb-assistant" issues
  (AIR-547–583) and AIR-673 reference a *different* product's files that do not
  exist in this `scout` repo. Already flagged by the concurrent perf pass
  (commit `1bc6f68`) and tracked (AIR-673, blocked). Not an architecture item.

## Assessment

The architecture is in good shape and prior passes have worked the structural
debt down thoroughly. The single live, un-tracked structural gap found this pass
(the nav popover duplication) was small and clearly-safe enough to fix directly;
it also happened to remove the exact hand-editing burden a change from earlier
today (AIR-407) had just paid. No new fix-issues are warranted — deferring
issue-manufacturing is the correct call given the exhaustive prior coverage and
the concurrent batch already sweeping every other quality dimension.
