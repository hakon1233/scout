# AIR-161 — Performance & bundle-size findings

_Quality Loop perf pass. Date: 2026-06-25. Agent: CTO._

App shape: Next.js 16 / React 19 **static export** (`output: "export"`,
`images.unoptimized`). Everything in `public/` is copied verbatim into the
shipped `out/`. No runtime image optimization, so asset weight ships as-is.

## Fixed in this pass (direct, reversible)

- **Dropped 1.7 MB of dead `public/redesign/` assets.** Four redesign-proposal
  HTML mockups (PER-114) + eight before/after PNG screenshots shipped in the
  static export but were referenced by **nothing** in `src/`, `e2e/`, or config.
  Same class as the earlier FLI-121 cleanup. The product's live assets are now
  just icons + `og.png` (~300 KB). Reversible via git history; design artifacts
  also have a non-shipping home under the repo-root `design/` dir.

## Filed as fix-issues (need care / testing — not "clearly safe")

Ranked by impact. Each is small and reversible but touches the hot render path
of the 620-line `src/app/app/page.tsx`, which has **no unit-test coverage**
(the test suite only covers `@scout/agent`), so each needs manual verification.

1. **Perpetual 10 s companion poll** — `src/app/app/page.tsx:99-115`.
   `setInterval(check, 10_000)` re-runs `bootstrapCompanionToken()` +
   `pingCompanion()` (→ `discoverCompanion` same-origin `/healthz`, port sweep
   on miss) forever, even after `companionReady` is true. Steady background
   network + main-thread wakeups. Fix: back off / widen interval once confirmed.
   _Not trivial: must keep detecting companion drop-out._

2. **`loadCompanionToken()` called in render** — `src/app/app/page.tsx:560`.
   Synchronous `localStorage.getItem` on every render, passed to `BriefHistory`.
   Cannot be naively hoisted to mount-time state: the 10 s interval
   auto-adopts the pairing token (line 105) and `BriefHistory` currently picks
   up the new value _because_ it re-reads each render. Fix must thread the
   adopted token through state so late adoption still propagates.

3. **Unmemoized derived work on the brief** — `filteredBrief`
   (page.tsx:423-429) and the `coverageBuckets(brief)` IIFE (page.tsx:492-531)
   recompute `.filter`/`.map` over all articles on every render and mint new
   object identities that defeat child `useMemo`s in `BriefLayout`/`FeedView`.
   Cheap individually (one brief's worth of stories) but on the hot path. Fix:
   `useMemo` keyed on `[brief, activeFilter]`.

4. **Profile-load fetch waterfall** —
   `src/components/profile/useProfileWorkbench.ts:189-220`. Independent
   `fetchChatTranscript`, `fetchInterestsFull`, `fetchCompanionInterests` run
   strictly sequentially; `Promise.all` would roughly halve first-paint latency
   on the profile page. Fix must preserve early-return/ordering logic.

## Checked and found healthy (no action)

- `FeedView` list uses stable `key={it.id}`; `buildFeed`/`cards`/`items` are
  properly `useMemo`'d. No virtualization gap (lists are one brief, not unbounded).
- Regexes in `companion.ts` are module-level constants, not per-call.
- `og.png` (123 KB) and icons (≤17 KB) are reasonably sized; no image win.
- The 2 s poll loop during an active generation run (`companion.ts:609-619`) is
  acceptable for a multi-minute job and uses cached base URLs.
