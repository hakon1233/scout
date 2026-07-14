# Design / UX audit — 2026-06-25

Recurring Quality-Loop pass (AIR-201, Designer). Scope: accessibility (labels,
keyboard operability, contrast), error/empty/loading states, dead or misleading
affordances, copy quality, and off-brand styling — audited against the Direction A
"Private Wire Service" editorial brand (PER-114). Audited at `origin/main`
(post-AIR-182). Apify scrape **not** run — guardrail honored; no Scout flow calls it.

## Summary

Scout's UI is in strong shape. The design-token system is mature and disciplined
(two-layer primitive→semantic model, PER-9), and there have been several prior
accessibility passes: a global focus-ring baseline (PER-19, WCAG 2.4.7/1.4.11),
`prefers-reduced-motion` handling on every animation, 44px switch/pill target sizes
(WCAG 2.5.8), a `role="switch"` Toggle, labelled icon-only controls, and a calm
warm-info banner palette chosen for AA body contrast (PER-130). Empty / loading /
error states are first-class: 16 files use shared `EmptyState` / `Banner` / skeleton
components, `ErrorBanner` classifies auth/rate-limit/network/unknown errors with
distinct, actionable copy, and the Skills page is honest ("In development" badge,
source-derived not marketing).

**One concrete, systematic defect was found and fixed in this pass:** an undefined
design token (`surface-strong`) silently dropped intended background fills on three
interactive surfaces.

## Findings (prioritized)

### 1. [Medium — FIXED this pass] `surface-strong` token referenced but never defined → dead fills

`bg-surface-strong` / `hover:bg-surface-strong` were used in four places, but
`--color-surface-strong` was **not** declared in the `@theme` block of
`src/app/globals.css`. In Tailwind v4 a `bg-X` utility only exists if a matching
`--color-X` token is registered, so every one of these utilities compiled to
**nothing** — the intended fills/hovers were silently missing in both themes.

Affected surfaces:

- **`AppNav.tsx:340` — the primary "Run now" menu item.** It was meant to read as the
  filled, primary action (vs. the un-filled secondary "Weekly brief" beneath it). With
  the token missing it rendered with no background, so the *primary* action looked
  *less* prominent than the secondary one below it — an inverted affordance hierarchy.
- **`RunScopeSelector.tsx:26` — the active/selected run-scope pill.** The selected
  pill's intended filled background never applied; selection was carried only by border
  weight + bold text, weakening the selected-vs-unselected distinction.
- **`Chip.tsx:26` and `Chip.tsx:58` — chip hover and the chip remove-button hover.**
  Dead hover states (no visual feedback on hover).

**Fix (this pass):** added the missing token to the existing two-layer model in
`globals.css` — a warm raised/selected fill one step deeper than `surface-muted`
(light `#e8dfcd`, dark `#2e2920`) plus the `--color-surface-strong` `@theme` mapping.
Verified the `bg-surface-strong` rule is now emitted in the compiled CSS and that
`pnpm lint` + `pnpm build` stay green. Small and fully reversible (revert the three
token lines). No component markup changed, so all four call sites light up at once.

## Checked and OK (no action)

- **Accessibility:** focus rings present app-wide; `Toggle` is a real `role="switch"`;
  icon-only controls carry `aria-label`; all `<img>` use `alt=""` for decorative
  favicons/lead images (headline carries meaning); reduced-motion respected.
- **Error/empty/loading:** `ErrorBanner` gives per-error-class actionable copy with a
  retry; skeletons exist for app/brief/profile; `EmptyState` is shared and consistent.
- **Copy:** editorial voice is consistent ("Your brief is filed", "filed every
  morning"); the 404 is route-aware (in-app vs. marketing); no placeholder/"coming
  soon" stubs found in Scout surfaces.
- **Off-brand styling:** the landing page's many arbitrary `[..px]` values are
  intentional editorial typography and all reference brand color tokens — not off-brand.

## Not re-filed (already tracked / out of scope)

- The open `[QPv*-design]` backlog (property cards, competitors, calendar, "Hostly"
  brand) belongs to a **different product**, not Scout — none of those components exist
  in this repo, so they are not duplicates and were not touched here.

## Note (environment, not a design finding)

The project workspace had a stale `node_modules` (declared dep `rehype-sanitize`
uninstalled, so `pnpm build` failed before any of my changes). Ran `pnpm install` to
restore it; this is unrelated to the audit and required only to verify the build.
