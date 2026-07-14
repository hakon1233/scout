# Performance & bundle-size pass - 2026-07-14 (AIR-668)

Recurring Quality-Loop performance pass.

## Workspace note: stale local `main` fork

This workspace's local `main` branch had silently diverged from `origin/main`
at `b1f3486` (AIR-204, 2026-06-25) into a 19-commit dead-end lineage of
docs-only "performance pass" audits (AIR-218 → AIR-448), each concluding
"source frozen since AIR-313; sole lever AIR-100 stays design-gated" — because
each of those passes was auditing the stale local fork, not the real,
actively-developed `origin/main` (126 commits ahead, with real feature/bugfix
work including the last four *actual* performance passes — AIR-529, AIR-605,
AIR-617, AIR-633 — which correctly worked from `origin/main`/its own
short-lived branch each time and landed real fixes).

Net effect: an unknown number of past "performance pass" cycles in this
workspace were no-ops that re-confirmed a frozen snapshot instead of auditing
the live product. Left local `main` untouched (a `git reset --hard` to fix it
was denied — deferring to the user); worked instead from a fresh branch off
`origin/main` (`air-668-performance-pass`). **Recommend**: either reset local
`main` to `origin/main` (its 19 orphaned commits carry no unique value beyond
"nothing changed," easily verified in reflog first), or have future passes
explicitly verify `git merge-base --is-ancestor HEAD origin/main` before
trusting a local checkout.

## Scope

Five real performance passes now precede this one (AIR-529, AIR-605, AIR-617,
AIR-633) and have exhaustively covered `src/` and `packages/agent/src/` —
bundle composition, re-renders, poll waterfalls, images/fonts, agent-backend
hot paths. Rather than re-litigate settled ground, this pass diffed
`origin/main` since AIR-633's audit commit (`0429e19`, 2026-07-11): 19 commits,
24 files, ~1000 lines, all bug fixes (AIR-107, AIR-425, AIR-509, AIR-540,
AIR-600, AIR-611, AIR-612, AIR-635, AIR-644, AIR-645, AIR-646, AIR-181, an
a11y fix, and one incidental lint-cleanup commit). Read every changed hunk
against the same hot-path/re-render/waterfall categories the prior passes
used, then re-measured the production bundle to catch anything the manual
read missed.

## Fixed this pass

1. **Three favicon `<img>` tags were swapped for `next/image` as an
   incidental side effect of an unrelated bug-fix commit** ("fix(agent):
   preserve fresh interest state during run requests", 2026-07-12 —
   commit message: "Also removes the current Next image lint warnings from
   the web surfaces"), regressing **every** route's first-load JS by
   11–47 KB (2–8%). `src/components/FeedView.tsx` (`FeedDetail`'s source-link
   favicon), `src/app/app/liked/page.tsx` (`LikedCard`'s favicon), and
   `src/components/ui/Chip.tsx` (citation-chip favicon) all switched a plain
   `<img>` to `next/image`'s `<Image>` purely to silence the
   `@next/next/no-img-element` ESLint warning. But `next.config.ts` sets
   `images: { unoptimized: true }` (this is a static export) — `next/image`
   does zero optimization here, it just ships its client runtime (lazy-load
   observer, layout-shift guards, etc.) for a 12–16px icon that was already
   `loading="lazy"` as a plain `<img>`. Worse, `FeedView.tsx` *itself*
   documents right below the changed line, in `FeedImage`, why arbitrary/
   external-host images can't safely use `next/image` — the favicon swap
   contradicted its own file's stated reasoning.

   Reverted all three to plain `<img loading="lazy">` with an
   `eslint-disable-next-line @next/next/no-img-element` (same pattern
   `FeedImage` already uses), matching the file's own established
   precedent instead of introducing a second one. Confirmed empirically —
   see Measured below — this recovers effectively the entire regression.

## Investigated, not fixed

- **`Chip` (`src/components/ui/Chip.tsx`) is dead code** — exported from the
  `ui` barrel but not imported by any route, component, or test. Confirmed
  via grep across `src/`, `test/`, `e2e/`. Has **zero** bundle impact (tree-
  shaken already, verified: reverting only `FeedView.tsx` and `liked/page.tsx`
  recovered the identical bytes-per-route as reverting all three, isolating
  `Chip.tsx`'s own contribution to nothing). Tech-debt, not a performance
  item — noted for whoever next runs the architecture/tech-debt pass
  (AIR-619/635/279's lane), not filed as its own issue.
- Re-confirmed the 19 non-`Chip`-swap commits since AIR-633 introduce no
  re-render regressions, N+1/waterfall patterns, or main-thread hot-path
  cost: `useProfileWorkbench.ts`'s new `messagesRef` mirror effect and
  `resolveRetryTarget`/`appliedChangeMessage` helpers are all O(n) single-pass
  over the (small, bounded) message/turn log, not per-poll-tick work.
  `companion.ts`'s `resolveLastSuccessBrief` (AIR-644) only issues its extra
  history-fetch on the already-unhealthy path, preserving AIR-605/617's poll
  dedup on the healthy path. `packages/agent`'s `loadState` reload in
  `handlePutInterests`/`handlePostInterests`/`handlePutSchedule` (AIR-107) adds
  one disk read to low-frequency, user-initiated write endpoints — not hot
  paths. No new dependencies landed (`package.json` unchanged).
- Images/fonts/assets: no new files in `public/`; `og.png` (123 KB, OG-meta-
  only, previously accepted) is the only asset over a few KB. Nothing new
  since AIR-633.
- AIR-639 (chat-transcript cap / `since`-aware `GET /v0/chat`, filed by
  AIR-633) is still open in the backlog — not re-filed.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-633 baseline | before this pass's fix | after fix |
|---|---:|---:|---:|
| `/app/interests` | 650,856 | 663,933 (+13,077) | 652,716 (+1,860) |
| `/app/connect` | 590,379 | 637,152 (+46,773) | 590,885 (+506) |
| `/app` | 625,079 | 636,859 (+11,780) | 625,625 (+546) |
| `/app/interests/interest` | 585,244 | 632,017 (+46,773) | 585,864 (+620) |
| `/app/profile/interest` | 585,244 | 632,017 (+46,773) | 585,864 (+620) |
| `/app/profile` | 581,025 | 611,561 (+30,536) | 581,216 (+191) |
| `/app/settings` | 599,180 | 610,903 (+11,723) | 599,686 (+506) |
| `/app/liked` | 597,764 | 609,246 (+11,482) | 597,995 (+231) |
| `/app/skills` | 596,382 | 607,790 (+11,408) | 596,573 (+191) |
| `/app/chat` | 571,001 | 601,537 (+30,536) | 571,192 (+191) |
| `/` | 555,360 | 571,019 (+15,659) | 555,716 (+356) |

The residual +191..+1,860 byte deltas vs. the AIR-633 baseline are genuine new
feature code landed since (AIR-611 undo cards, AIR-644/645 confirm-state
persistence) — expected, not a regression.

## Verification

- `CI=true pnpm typecheck` passed (0 errors).
- `CI=true pnpm lint` passed (0 errors, 0 warnings).
- `CI=true pnpm test` passed (1 + 161 + 51 = 213/213).
- `CI=true pnpm build` passed; bundle re-measured post-fix (see above).
- Targeted e2e on an isolated port (default port held by another process):
  `SCOUT_E2E_PORT=47922 npx playwright test feed-story-detail.spec.ts
  liked-feed.spec.ts feed-like-roundtrip.spec.ts` — 10/10 passed, exercising
  the exact surfaces touched (feed detail favicon link, liked-card favicon,
  like/unlike roundtrip).
- No paid Apify scrape or external product flow was run.

## Follow-ups

- None filed — the one real regression found was small, clearly safe, and
  fixed directly in this pass. `Chip.tsx` dead code noted above for the
  architecture/tech-debt lane, not filed (zero perf impact, pure tidiness).
- Workspace note (above): recommend fixing the stale local `main` fork so
  future passes don't silently re-audit a frozen snapshot.
