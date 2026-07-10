# Performance & bundle-size pass - 2026-07-10 (AIR-605)

Recurring Quality-Loop performance pass. Started from `origin/main` at
`72a58ea` (AIR-529, 2 days prior) — no other commits had landed on trunk in
between, so this pass audited for what AIR-529 missed rather than re-auditing
already-fixed ground.

## Fixed this pass

1. **Duplicate `/v0/briefs` request on every companion poll tick.**
   `fetchRunFailure` (`src/lib/companion.ts`) fired three requests in
   `Promise.all` on every 10-30s poll (`src/app/app/page.tsx`'s
   `companionReady`-gated interval, AIR-529): a direct `pollBriefsRaw(...)`
   call for the last-brief slot, plus `fetchLatestBrief(token)` — which
   internally calls `pollBriefsRaw` again with the *identical* `sinceTs` and
   token. Two of the three requests were the same GET, executed in parallel,
   forever, for the life of the session. Extracted a shared
   `newestReadyBrief(raw)` helper so `fetchRunFailure` derives the newest
   ready brief from the raw list it already fetched, instead of re-fetching
   it. `fetchLatestBrief` now shares the same helper (also a small dedup —
   the filter/map/reduce-to-newest logic was previously duplicated across
   both functions). One request removed per poll tick; no behavior change
   (same filter/map/reduce over the same data — verified by reading both call
   paths side by side).

2. **`ChatDock` re-rendered (and re-parsed markdown for) the entire message
   transcript on every composer keystroke.** The composer's `draft` state
   lived in the same component as `messages.map(...)`, so every keystroke
   re-rendered every visible `ChatMarkdown`/`ReactMarkdown` instance in the
   transcript — real, non-trivial CPU work on the primary interests-editing
   surface, worse as a conversation grows. All the callback props ChatDock
   passes down (`onSend`, `onStop`, `onRetry`, `onUndo`,
   `onConfirmDelete/CancelDelete`, `onConfirmRewrite/DiscardRewrite`) are
   already `useCallback`-stable in `useProfileWorkbench.ts`, so the fix was a
   straight extraction: moved `draft` state, the textarea ref, the
   auto-grow effect, `useCoarsePointer`, and the whole sticky-composer JSX
   into a new `Composer` child component that owns its own keystroke state.
   `ChatDock` now only re-renders on real transcript-affecting changes
   (`messages`, `streamId`, `streamLen`, `sending`, `atBottom`); typing in
   the composer no longer touches the message list at all. Root-caused
   rather than papered over with `React.memo` (which would have needed extra
   care to keep `messages.map`'s per-row props referentially stable, and
   wouldn't have addressed the underlying re-render trigger).

   Verified via the 4 existing Playwright specs that exercise `ChatDock`
   end-to-end against the real static export + companion tarball (all
   offline, stub `claude` shell-out — `SCOUT_E2E_PORT=... npx playwright
   test responsive-chat.spec.ts reduced-motion-chat.spec.ts
   markdown-chat.spec.ts zero-prompt.spec.ts`): 10/10 passed, covering
   message send, scroll-to-bottom/scroll-pill behavior, reduced-motion
   scroll, and responsive pane layout — the paths most likely to break from
   moving state across a component boundary.

## Reviewed, no action taken (narrow/low severity)

- `src/app/app/page.tsx:462` — `filteredBrief` (spread + `.filter`) is
  recomputed unmemoized on every render, including background poll ticks.
  Cheap (one day's article list, not a large collection); a `useMemo` here
  would be premature optimization for the actual cost.
- `src/app/app/page.tsx:667` — `loadCompanionToken()` (a `localStorage.getItem`)
  is called directly in JSX rather than via state/effect. Synchronous,
  cheap, SSR-safe already (static export); not worth restructuring for.
- `src/components/AppNav.tsx:182` — the mobile filter dropdown's scroll
  listener does an unthrottled `getBoundingClientRect()` + `setState` per
  scroll event, but only while the dropdown is open. Narrow surface, low
  impact.
- No `React.memo` usage and no Context providers exist anywhere in `src/` —
  the "inline prop defeats memoization" and "unmemoized context value"
  failure modes don't apply to this codebase.
- No new N+1/waterfall patterns found beyond the one fixed above;
  `useProfileWorkbench.ts`'s AIR-529 `Promise.all` fix holds.
- No heavy client-only libraries beyond `react-markdown` (already
  code-split by AIR-529) exist in `package.json` to split further.
- Images: no oversized assets beyond the already-accepted OG image
  (`public/og.png`, 123KB, OG-only).

## Measured (unchanged from AIR-529 — these fixes are network/render, not bundle)

Production build (`CI=true pnpm build`), route bundle sizes from
`.next/diagnostics/route-bundle-stats.json` — identical to AIR-529's
post-fix numbers (expected: neither fix here touches what ships to the
client bundle):

| route | firstLoadUncompressedJsBytes |
|---|---:|
| `/app/interests` | 626,391 |
| `/app` | 600,778 |
| `/app/settings` | 575,014 |
| `/app/skills` | 572,474 |
| `/app/liked` | 569,574 |
| `/app/connect` | 566,051 |
| `/app/interests/interest` | 561,040 |
| `/app/profile/interest` | 561,040 |
| `/app/profile` | 557,117 |
| `/` | 554,764 |
| `/app/chat` | 547,093 |

## Open from prior passes (not re-filed)

- **AIR-535** (reconcile/retire the stale `air-437-briefhistory-fetch-error`
  branch) is still open/`todo`. Not a performance item; left to its own
  issue per the "don't re-file items already tracked" guardrail.

## Verification

- `CI=true pnpm typecheck` passed (0 errors).
- `CI=true pnpm lint` passed (0 errors, 29 pre-existing warnings, unchanged).
- `CI=true pnpm test` passed (155 + 25 = 180/180).
- `CI=true pnpm build` passed; bundle re-measured from the fresh `out/`
  directory and `.next/diagnostics/route-bundle-stats.json` — no regression.
- `SCOUT_E2E_PORT=47919 npx playwright test responsive-chat.spec.ts
  reduced-motion-chat.spec.ts markdown-chat.spec.ts zero-prompt.spec.ts`
  passed 10/10 (isolated port — the default 47821 was held by an unrelated
  long-running `@scout/agent` process from a different workspace, left
  untouched).
- No paid Apify scrape or external product flow was run.
