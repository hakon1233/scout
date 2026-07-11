# Performance & bundle-size pass — 2026-06-26 (FLI-219)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). This pass runs ~1 day after two back-to-back passes
(`2026-06-25-performance-bundle-pass.md` / FLI-198 and
`...-AIR-204.md`), which already took the headline wins (1.7 MB redesign
microsite removed, `react-markdown` code-split off `/app`, companion-probe
coalescing, hot-path regex hoisting). This pass re-measured the current build,
verified those wins held, and looked for what the prior passes did **not** cover.

## What was measured (fresh production build)

- `pnpm typecheck` clean; `pnpm lint` 0 errors (31 pre-existing `<img>` warnings,
  inherent to `output: "export"` + `images.unoptimized`); `pnpm test` 128/128;
  `pnpm build` green.
- **Static export (`out/`)**: **2.7 MB**.
- **JS**: ~1068 KB raw / **~301 KB gzip** total across chunks. Largest are the
  framework/react-dom chunk (~233 KB raw / 73 KB gz) and the markdown graph
  (~111 KB raw / 34 KB gz, now a lazy chunk — see below).
- **Fonts**: **554 KB across 22 woff2 files** — the single largest on-the-wire
  asset class (woff2 is already compressed, so this does not shrink further over
  the wire, unlike the gzip'd JS).
- `public/`: no oversized assets (largest `og.png` 124 KB — appropriate for OG).

### Per-route initial JS (raw, referenced by prebuilt HTML)

| Route | Initial JS | markdown in initial? |
|-------|-----------:|:--------------------:|
| `/` (home) | 649 KB | no |
| `/app` | 692 KB | no |
| `/app/liked` | 665 KB | no |
| `/app/chat` | 643 KB | no |
| `/app/connect` | 660 KB | no |
| `/app/settings` | 669 KB | no |
| `/app/profile` | 652 KB | no |
| **`/app/interests`** | **834 KB** | **YES** |

## Verified: prior wins held

- **`react-markdown` is off the initial bundle on every route except
  `/app/interests`.** AIR-186's `next/dynamic` split of `FeedBody` keeps it out
  of `/app`; because `FeedView` no longer statically imports `react-markdown`,
  `/app/liked` (which imports leaf helpers from `FeedView`) also no longer drags
  it in. Confirmed empirically — both pages build with `markdown-in-initial: no`.
  The one remaining eager importer is `/app/interests` (`InterestScopeView` /
  `InterestDocCard` render the doc body markdown), already tracked by **AIR-194**.
- Companion-probe fan-out on the `/app` paint path is coalesced (AIR-204).

> A redundant change was started this pass (re-splitting markdown + extracting
> `feed-utils.tsx`) before discovering AIR-186 had already landed the win on
> `main`; it was measured to add only ~9 KB to `/app/liked` and was **dropped**
> rather than pushed, to avoid duplicate churn.

## New finding — fonts (the biggest untracked item)

`src/app/layout.tsx` loads **four** `next/font/google` families:

| Family | Role | Request |
|--------|------|---------|
| Inter | UI sans (`--font-sans`) | weights 400/500/600, latin |
| JetBrains Mono | datelines/labels (`--font-mono`) | weight 500, latin |
| Fraunces | display serif (`--font-serif`) | weights 400/500/600/700, latin |
| Newsreader | reading serif (`--font-reading`) | variable, normal **+ italic**, latin |

All four families are genuinely referenced in `globals.css`, so none is dead.
Total shipped: **554 KB / 22 woff2 files** — larger than the gzip'd JS payload.

Two things prior passes missed because they were chasing the **stale** AIR-100
"@fontsource subset" issue — but the app no longer uses `@fontsource`; it uses
`next/font/google`:

1. **Fraunces requests weight 700, which is never rendered.** There is no
   `font-bold`/`font-black` utility anywhere in `src`; every serif heading and
   markdown `strong` is explicitly weight 600, body serif is 400, one masthead is
   500. Trimming the request to `["400","500","600"]` was tested — it produced
   **zero** payload change because Fraunces is a *variable* font (one file spans
   the weight axis regardless of the discrete list). So the weight list is
   cosmetic; the real cost is the four variable faces themselves, not the weights.
2. **The real lever is the family/style count, which is a design decision**, not
   a behavior-preserving code fix:
   - Newsreader ships both a normal **and** an italic variable face; dropping
     italic would make markdown `<em>` synthesize obliques (a visible change).
   - Two serif families (Fraunces display + Newsreader reading) is a deliberate
     "private wire service" type system (PER-114).

   Because each option changes rendered type, this is **filed for the type-system
   owner (Designer/CTO) to weigh**, not fixed here. See the new fix-issue.

## Stale tracked issues — recommend closing (not re-filed)

The AIR tracker lists two perf issues that reference dependencies that **no
longer exist anywhere in the repo source** (verified by grep across `*.ts(x)` and
`package.json`):

- **AIR-100** — "import only needed `@fontsource/inter` subsets." The app migrated
  to `next/font/google`; there is no `@fontsource` dependency. **Stale.**
- **AIR-101** — "remove dead chart/carousel UI + `recharts`/`embla` deps." Neither
  package is in `package.json` or imported anywhere. **Stale / already done.**

Recommend the board close both rather than leave phantom perf work open.

## Still-valid tracked items (not re-filed)

`AIR-194` (lazy markdown on `/app/interests`), `AIR-173` (back off the 10 s
companion poll once ready), `AIR-174` (memoize brief-derived work in the `/app`
render), `AIR-178` (cap chat transcript growth).

## Not worth a needle-move (noted)

- The 31 `<img>` lint warnings are inherent to `output: "export"` with
  `images.unoptimized` (`next/image` optimization is unavailable on static
  export) — expected, not actionable.
- `FeedView` is already tight (memoized `items`, lazy markdown body, lazy images).
