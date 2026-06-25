# Performance & bundle-size pass — 2026-06-25 (AIR-204)

Recurring Quality-Loop perf pass. Next.js 16 / React 19, static export
(`output: "export"`). This pass ran shortly after FLI-198 (see
`2026-06-25-performance-bundle-pass.md`), so most of the headline wins (1.7 MB
redesign microsite removed, regex hoisting, `localeCompare` drop) were already
landed. This pass focused on the remaining redundant network fan-out on the
primary paint path and on confirming the rest is already tracked.

## What was measured

- `pnpm typecheck` clean; `pnpm lint` 0 errors (31 pre-existing `<img>` warnings,
  inherent to `output: "export"` with `images.unoptimized` — not actionable);
  `pnpm test` 128/128; `pnpm build` green.
- Dependency surface is minimal: only `react-markdown` + `rehype-sanitize` are
  heavy, and they are already code-split out of the `/app` feed (AIR-186) and
  tracked for the remaining routes (AIR-194).
- `public/` has no oversized assets (largest is `og.png`, 120 KB — appropriate
  for an OG image).

## Fixed this pass (small, clearly-safe, behavior-preserving) — committed `0b3f5fd`

**Coalesced the `/app` mount companion-probe fan-out.** On mount the page fires
several effects in the same tick that each probe the loopback companion:
`bootstrapCompanionToken` (10s poll effect + brief-adoption effect) and
`fetchCompanionInterests` (interest-adoption effect + reconcile effect). Each
independently did a same-origin `GET /healthz` then `GET /v0/config`, so the
primary paint path issued ~2 redundant `/healthz` probes and **3–4 identical
`/v0/config` fetches**.

- `isServedFromCompanion()` now shares one in-flight `/healthz` promise across
  the concurrent mount calls (the positive result was already memoized; this
  closes the window before the first probe resolves, when none is yet confirmed).
- New `fetchCompanionConfig()` coalesces `GET /v0/config` behind one in-flight
  promise + a 3 s TTL; `bootstrapCompanionToken` and `fetchCompanionInterests`
  both route through it.

Behavior-preserving: identical token-adoption and interest-recovery semantics —
only the duplicate network requests are removed. The 3 s TTL is well under the
10 s poll interval, so a token/interests change is still picked up on the next
tick. This is the same finding FLI-198 flagged HIGH ("single in-flight-promise
cache in companion.ts"); it was not yet landed in this (AIR) tracker, so it was
fixed directly rather than re-filed.

## Already tracked — not re-filed (verified open in the AIR tracker)

| Issue | What |
|-------|------|
| AIR-173 | Back off the 10 s companion poll once ready. |
| AIR-174 | Memoize brief-derived work + token read in the `/app` page render (covers the `likeInputFor`/`loadCompanionToken`-in-render churn FLI-198 flagged MED). |
| AIR-194 | Lazy-load `react-markdown` on the chat / interests / profile routes (the importers that still render markdown on first paint). |
| AIR-178 | Cap chat transcript growth to last-N turns. |
| AIR-100 | Import only the needed `@fontsource/inter` subsets. |
| AIR-101 | Remove dead chart/carousel UI + `recharts`/`embla` deps. |

## Not worth a needle-move (noted, not filed)

- `connect/page.tsx` 8 s ping interval after `setupComplete` — low impact and
  effectively subsumed by the probe-coalescing above + AIR-173.
- `FeedView` is already tight: `items` is memoized on `brief.articles`, the
  markdown body is lazy, and feed images are `loading="lazy"`.
- `<img>` lint warnings (31): expected on static export; `next/image`
  optimization is unavailable with `images.unoptimized`.
