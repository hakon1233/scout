# Performance & bundle-size pass — 2026-06-25 (FLI-198)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). Measured against a fresh production build.

## What was measured

- **Static export (`out/`)**: 4.5 MB → **2.8 MB** after this pass (−38%).
- **Initial JS** (`.next/static/chunks`): ~1.1 MB raw / ~290 KB gzip total across
  chunks. Largest chunks: framework/react-dom (233 KB raw / 73 KB gz) and the
  markdown graph (`micromark`/`react-markdown`/`rehype`, ~114 KB raw / 34 KB gz —
  already tracked by FLI-189).
- `pnpm typecheck` clean, `pnpm lint` 0 errors (31 pre-existing `<img>` warnings),
  `pnpm test` 127/127, `pnpm build` green.

## Fixed this pass (small, clearly-safe, behavior-preserving)

1. **Relocated the 1.7 MB redesign-proposal microsite out of `public/`.**
   `public/redesign/` (PER-114: index + a/b/c HTML + 9 PNG shots) is a one-off
   design-review board nothing in `src/`, docs, README, or e2e links to, yet
   `output: "export"` copied it into every deploy. Moved to
   `design/landing-redesign/` — artifact preserved in-repo, dropped from the
   shipped bundle. **Export 4.5 MB → 2.8 MB.** (Same class as FLI-121.)
2. **Hoisted invariant regexes in `companion.ts` `stripInlineMarkdown()`.** Two
   `new RegExp(...)` were recompiled on every call; the pattern is constant. This
   runs per story bullet, per brief, and per 2 s poll tick (`2·N·M` identical
   compiles for a history page of N briefs × M stories). Now module-level
   constants. Reuse with `String#replace` is safe (replace resets `lastIndex`).
3. **Dropped `localeCompare` from `useLikedStories()` sort.** `likedAt` is
   ISO-8601, so lexicographic order already equals chronological order. Plain
   string compare removes the per-comparison Intl cost on every like toggle
   (re-sorts the whole collection each change).

## Already tracked — not re-filed

- FLI-187 — memoize `ChatMarkdown` (re-parses every typewriter beat).
- FLI-189 — code-split the `react-markdown` stack out of initial JS.
- FLI-188 — parallelize `discoverCompanion` sequential port-sweep.
- FLI-99 — vendor `manualChunks` split. **Note: stale** — it references
  `vite.config`, but the app is Next.js now (no Rollup `manualChunks`); Next/
  Turbopack already vendor-splits the framework chunk. Recommend re-scoping or
  closing FLI-99.

## New findings — fix-issues opened (small, reversible)

| Sev | Finding | Where |
|-----|---------|-------|
| HIGH | `/app` mount fires 4 independent effects that each re-probe the companion (`bootstrapCompanionToken`/`fetchCompanionInterests` → repeated `/healthz` + `/v0/config`), a redundant loopback fan-out on the primary paint path. Fix: single in-flight-promise cache in `companion.ts`. Also blunts the connect-page sweep (LOW 6). | `src/app/app/page.tsx:99-226`, `src/lib/companion.ts` |
| MED | Render-path churn: `likeInputFor(item)` allocates a fresh object per `FeedCard` render (unstable `LikeButton` prop), and `loadCompanionToken()` (sync `localStorage.getItem`) is called inline in JSX on every `AppPage` render. Fix: `useMemo` both. | `src/components/FeedView.tsx:190`, `src/app/app/page.tsx:558` |

## Not worth a needle-move (noted, not filed)

- LOW: `connect/page.tsx` runs an 8 s ping interval that keeps sweeping ports
  after `setupComplete` redirects away. Subsumed by the HIGH companion-cache fix.
- `<img>` lint warnings (31): inherent to `output: "export"` with
  `images.unoptimized` — `next/image` optimization is unavailable on static
  export, so these are expected, not actionable here.
