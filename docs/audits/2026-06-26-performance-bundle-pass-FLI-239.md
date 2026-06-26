# Performance & bundle-size pass — 2026-06-26 (FLI-239)

Recurring Quality-Loop perf pass. Next.js 16.2.6 / React 19, static export
(`output: "export"`). This is the **fourth** perf pass in ~2 days, following
FLI-198 (`2026-06-25-performance-bundle-pass.md`), AIR-204
(`...-AIR-204.md`), and FLI-219 (`...-FLI-219.md`). The source tree is
**byte-identical** to what FLI-219 measured — `git log ad886d3..HEAD` is empty,
working tree clean — so this pass re-measured, ground-truthed the one open
question FLI-219 left (fonts), and looked for any *new* untracked needle-mover.

## What was measured (fresh clean production build, `rm -rf .next out`)

- `pnpm build` green (exit 0). Export (`out/`): **2.7 MB** — unchanged.
- **Fonts**: **22 woff2 / 567,496 B (554 KB) referenced**, 0 orphans on disk.
  Still the single largest on-the-wire asset class.
- JS / per-route initial bundles unchanged from FLI-219 (no source delta).
- Prior wins confirmed still in place (markdown code-split off every route but
  `/app/interests`; companion-probe coalescing) — no regression since FLI-219.

## Ground-truthed the font question (FLI-219's one open lever)

FLI-219 reported that trimming Fraunces' requested `weight: 700` produced **zero
payload change** and attributed it to "Fraunces is a variable font." This pass
verified that empirically and found the *conclusion is right but the reason is
imprecise*:

- The generated `@font-face` CSS shows Fraunces as **static** faces — 3 unicode
  subset files **per discrete weight** (400/500/600/700), 12 faces total — not a
  single variable file.
- Weight 700 is genuinely **never rendered**: the only `700` token anywhere in
  the repo is the font request itself (`layout.tsx:25`); there is no
  `font-bold`/`font-black`/`font-weight:700`, and every serif heading and
  markdown `strong` resolves to **600** (`globals.css`).
- **But** dropping `700` from the request was measured to change nothing:
  `567,496 B / 22 files` **with** 700, `567,496 B / 22 files` **without**. The
  per-weight static `@font-face` rules point at the **same shared woff2 files**
  (the three "700" files `1e219c03…`, `b35b0db…`, `03bda585…` remain referenced
  by the 400/500/600 faces). So the weight list is cosmetic — trimming it only
  removes 3 redundant CSS `@font-face` rules (negligible) for zero font bytes.

A trial edit removing `700` was made, clean-rebuilt, measured at byte-parity,
and **reverted** — keeping it would be a no-op churn commit of exactly the kind
FLI-219 already flagged ("a redundant change … was dropped rather than pushed").

The **real** font lever (drop a family or Newsreader's italic face) remains a
**design decision already filed by FLI-219** for the type-system owner
(Designer/CTO). Not re-filed here. Note also that the 554 KB is worst-case: the
22 files are `unicode-range` subsets, so a browser only fetches the subranges
whose glyphs actually appear — real on-wire font cost is lower still.

## New untracked needle-movers found this pass

**None.** Three passes in the preceding ~48 h took every clearly-safe win
(1.7 MB redesign microsite removed, markdown code-split, companion-probe
coalescing, hot-path regex hoisting, `localeCompare` drop). The small hot-path
libs re-scanned this pass (`storage.ts`, `run-history.ts`) are already tight
(no repeated parsing, no per-render allocation, ISO-lexicographic sorts).

## Still-valid tracked items (NOT re-filed)

- Companion-probe in-flight cache + render-path memoization (FLI-198 fix-issues).
- `AIR-194` — lazy markdown on `/app/interests` (the one route still eager).
- `AIR-173` — back off the companion poll once ready.
- `AIR-174` — memoize brief-derived work in the `/app` render.
- `AIR-178` — cap chat transcript growth.
- Font family/italic-face count — design decision filed by FLI-219.

## Recommend board housekeeping (carried from FLI-219, still true)

- `AIR-100` (@fontsource subset) and `AIR-101` (recharts/embla removal) reference
  dependencies that no longer exist in the repo — **stale**, recommend close.
- `FLI-99` (Vite `manualChunks`) references a Vite config; the app is Next.js —
  **stale**, recommend re-scope or close.

## Disposition

No safe code change was available this cycle that isn't already tracked or a
design decision. The product is in good shape for a static export of this size.
This pass's value is the re-measurement (green, no regression) and grounding the
font question to byte-level truth so the next pass need not re-investigate it.
