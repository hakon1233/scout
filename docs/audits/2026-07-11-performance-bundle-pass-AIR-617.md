# Performance & bundle-size pass - 2026-07-11 (AIR-617)

Recurring Quality-Loop performance pass. Started from a fresh branch off
`origin/main` at `cf8536e` (4 commits past AIR-605's `3cc1bcb` baseline:
CAR-272's error-boundary + copy-leak fixes, CAR-396's shared `EmptyState`
adoption, a docs fix) — the prior `air-529-performance-pass` branch was
already merged and stale, so this pass re-branched from trunk rather than
auditing dead ground (same practice AIR-529 established). Rebased onto
`origin/main` again before pushing (3 more commits landed mid-pass: AIR-619's
tech-debt cleanup + an agent-side date fix) — no conflicts, none of those
touched `companion.ts` or `ChatMarkdown.tsx`. Numbers below are measured
post-rebase, on the code actually pushed.

## Fixed this pass

1. **`ChatDock` re-parsed every prior message's markdown on every typewriter
   tick while a reply streamed in.** `src/components/profile/ChatMarkdown.tsx`.
   AIR-605 fixed the composer-keystroke case (extracted `draft` state so
   typing doesn't touch the transcript) but `ChatDock` still re-renders on
   `streamLen`, which a `setInterval` in `useProfileWorkbench.ts`'s
   `startStream` ticks every 24ms (~80 ticks, ≈2s) for every scout reply.
   Each tick re-executed `messages.map(...)`, and `ChatMarkdown` (wrapping
   `LazyMarkdown`/`react-markdown`) had no memo boundary, so every
   already-rendered message in the transcript re-ran the markdown pipeline on
   every tick of the *next* message's reveal — not just the one actually
   streaming. Wrapped `ChatMarkdown` in `React.memo`; its only prop is a
   primitive `text` string, so the default shallow-compare is exact (no
   custom comparator needed), and `messages`/`m.text` are referentially
   stable during a stream (verified: `startStream` only touches `streamId`/
   `streamLen` state, never `messages`). Only the currently-streaming
   message's slice re-renders now.

2. **Two concurrent `/healthz` pings, every poll tick, when the companion is
   cross-origin (the GitHub Pages + local-agent deployment, not the
   same-origin/Tailscale case).** `src/lib/companion.ts`'s
   `fetchRunFailure` runs `Promise.all([pollBriefsRaw(...), fetchSchedule(...)])`
   every poll (10-30s, `page.tsx`); both independently call `requireBase()` →
   `discoverCompanion()`, which re-verifies the already-cached companion base
   with a real `fetch(/healthz)` on *every* call — no TTL or coalescing,
   unlike the file's own `isServedFromCompanion` (in-flight-coalesced) and
   `fetchCompanionConfig` (TTL-cached + coalesced) helpers a few lines away.
   Added `pingCachedBase`, the same in-flight-coalescing idiom already used
   for `isServedFromCompanion`'s same-origin probe, so the two concurrent
   calls in one poll tick share a single ping instead of firing two. No TTL
   added — deliberately conservative: a call that finds the companion gone
   still re-sweeps immediately, same as before; this only dedupes the
   *concurrent* case.

3. **`newestReadyBrief` parsed the entire ready-brief history on every poll
   tick to keep a single brief.** `src/lib/companion.ts`. Both callers
   (`fetchLatestBrief`, `fetchRunFailure`) fetch `since = epoch` (the full
   ready history, which only grows over a companion's lifetime — this is a
   once-daily brief generator), and the AIR-605 dedup helper ran `adaptBrief`
   (a ~100-line regex pass over the brief's full markdown body) over *every*
   ready brief via `.map(adaptBrief)` before reducing to the max by
   `generatedAt` — full-history parse work thrown away for all but one
   result, repeated every 10-30s poll tick indefinitely. Reordered to find
   the winner on the cheap raw `generated_at` string first (same comparison
   the old code already trusted for ordering), then call `adaptBrief` once on
   just that entry. Same filter predicate, same "newest" comparison, same
   output — verified by reading both versions side by side; no test exists
   for this unexported helper (no fetch-mock harness in this suite), so this
   was checked by inspection plus the full e2e run below, which exercises the
   real poll path end-to-end against the packed companion tarball.

## Investigated, not fixed (filed as context, not issues — see reasoning)

- **Turbopack duplicates `AppNav`/`ErrorBanner`/`classifyError` into their own
  chunk for the new `/app/error.tsx` boundary (CAR-272), instead of reusing
  the copy already in every route's shared base chunk.** This is the actual
  cause of the ~24KB/route uncompressed growth visible between AIR-605's
  measurements and this pass's baseline (bisected via an isolated worktree
  build at CAR-272's commit alone: the delta is exactly one new chunk,
  23,570 bytes, containing a second copy of those three modules — confirmed
  via string search across all shared chunks). Not fixed: `error.tsx`
  deliberately renders `AppNav` for a legitimate, just-shipped UX reason (keep
  navigation available on a rendering error); removing that would reopen
  CAR-272. The duplication looks like a Turbopack chunk-splitting gap around
  per-route special files, not something safely fixable from application code
  without hand-rolled `splitChunks`/webpack config — risk/complexity doesn't
  clear the "small, clearly-safe" bar for this pass. ~7KB gzipped one-time
  cost across 8 routes; not re-filed as it's inherent to a feature that
  already shipped and was reviewed, not a new regression to chase.
- **`discoverCompanion`'s cross-origin path still re-verifies on every call,
  just no longer concurrently duplicated (see fix #2).** Considered adding a
  TTL (like `fetchCompanionConfig`'s 3s) to skip the ping entirely on most
  ticks, matching `CONFIG_TTL_MS`. Declined for this pass: a real request
  failure already surfaces connectivity loss through existing error-handling
  paths, so a TTL is *safe*, but it changes when a dead companion is detected
  (up to one TTL window later) — wanted that considered deliberately with its
  own verification rather than bundled into an unrelated dedup fix. Candidate
  for a follow-up if poll-tick network volume still matters after this pass.
- Duplicate identical since-epoch `/v0/briefs` fetches from `fetchRunFailure`
  and `fetchLatestBrief` at first mount (both call `pollBriefsRaw` with the
  same args) — only overlaps once, on the very first tick after hydration;
  narrow enough that a fix is only worth doing alongside a larger
  cache/coalescing pass on `pollBriefsRaw` itself, not on its own.
- Re-checked AIR-605's three declined items (`filteredBrief` unmemoized in
  `page.tsx`, `loadCompanionToken()` in JSX, `AppNav`'s unthrottled scroll
  listener) — still narrow/low-severity, nothing changed since to reopen them.
- Images: no oversized assets beyond the already-accepted OG image
  (`public/og.png`, 123KB). No new heavy client-only libraries in
  `package.json`.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`
— unchanged by this pass's fixes (both are runtime/network fixes, not
bundle-shape changes; the ~24KB/route jump from AIR-605's baseline predates
this pass, see the CAR-272 finding above):

| route | AIR-605 baseline | this pass |
|---|---:|---:|
| `/app/interests` | 626,391 | 650,856 |
| `/app` | 600,778 | 625,079 |
| `/app/settings` | 575,014 | 599,180 |
| `/app/skills` | 572,474 | 596,382 |
| `/app/liked` | 569,574 | 597,764 |
| `/app/connect` | 566,051 | 590,379 |
| `/app/interests/interest` | 561,040 | 585,244 |
| `/app/profile/interest` | 561,040 | 585,244 |
| `/app/profile` | 557,117 | 581,025 |
| `/app/chat` | 547,093 | 571,001 |
| `/` | 554,764 | 555,360 |

(The extra ~38 bytes on the three `interest`-detail routes vs. the
pre-rebase measurement above is AIR-619's `mergeInterests` hoist, landed
independently during this pass — not this pass's own fixes.)

## Verification

All numbers below are from the **post-rebase** tree (`origin/main` +
this pass's one commit) — the code actually pushed.

- `CI=true pnpm typecheck` passed (0 errors).
- `CI=true pnpm lint` passed (0 errors, 29 pre-existing warnings, unchanged).
- `CI=true pnpm test` passed (157 + 1 + 30 = 188/188 — up from AIR-605's 180
  due to intervening commits' own new tests, none touched here; the jump
  27→30 in the web suite is AIR-619 wiring up the previously-orphaned
  `safe-storage.test.ts`, not this pass).
- `CI=true pnpm build` passed; bundle re-measured from the fresh `out/`
  directory and `.next/diagnostics/route-bundle-stats.json`.
- Full Playwright e2e suite (`SCOUT_E2E_PORT=47919 npx playwright test
  --config e2e/playwright.config.ts`, isolated port — default 47821 held by
  an unrelated long-running process, same as AIR-605), run twice (pre- and
  post-rebase): 26/28 passed both times. The 2 failures
  (`feed-filter-theme.spec.ts`, `liked-feed.spec.ts`, both a `toHaveCSS`
  color-value mismatch, e.g. expected `rgb(196, 85, 63)` got
  `rgb(210, 105, 76)`) were confirmed **pre-existing** — reproduced
  identically on a clean checkout of `origin/main` (`cf8536e`) in an isolated
  clone before any change in this pass, so they're an environment/
  color-rendering issue in this sandbox's Chromium, not a regression from
  this work. Not re-filed: e2e isn't part of the `pnpm test` CI gate per
  `AGENTS.md`, and the failure is unrelated to anything performance/
  bundle-shaped.
- No paid Apify scrape or external product flow was run.

## Follow-ups (not filed as issues — see reasoning above)

- Optional TTL for `discoverCompanion`'s cross-origin re-ping, if poll-tick
  network volume is still worth trimming after this pass's dedup.
- The CAR-272 error-boundary chunk-duplication is noted for whoever next
  touches Next.js/Turbopack chunk config on this app; not actionable as a
  small reversible fix today.
