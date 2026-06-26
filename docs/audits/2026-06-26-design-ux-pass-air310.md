# Design / UX audit — 2026-06-26 (AIR-310)

Recurring Quality-Loop pass (AIR-310, Designer). Scope: accessibility (labels,
keyboard operability, contrast), error/empty/loading states, dead or misleading
affordances, copy quality, and off-brand styling — audited against the
Direction A "Private Wire Service" editorial brand. Builds on AIR-201 / AIR-215
/ AIR-227 (the prior Scout design passes). Apify scrape **not** run — hard
guardrail honored; no Scout flow calls it.

## Summary

Scout's UI remains in strong shape and the prior passes' structural conclusions
hold (disciplined two-layer tokens, first-class error/empty/loading states, good
a11y hygiene). This pass found **one genuinely new, untracked accessibility gap**
and **fixed it directly** because it was small and fully reversible: every in-app
`/app/*` route shipped the same static document title.

It also surfaces a **correction to the prior passes' bookkeeping**: the
`[QP-design]` / `[QPv*-design]` prefix is a *Quality-Pass cycle tag used across
two products*, not a product marker. Several open `[QP*]` issues genuinely track
**Scout** surfaces (verified by the `src/...` paths in their bodies) and are
already filed — so this pass did **not** re-file them. Earlier passes had
blanket-dismissed the whole `[QP*]` backlog as "a different product"; that is
only true for the items whose paths point at `airbnb-assistant`.

## Findings (prioritized)

### 1. [Medium — FIXED this pass] All `/app/*` routes share one document title (WCAG 2.4.2)

`src/app/layout.tsx:36` sets a single static
`title = "Scout — Personalized AI news, delivered by agents."`, and **none** of
the in-app routes override it. All nine `/app/*` route components are
`"use client"` (verified: 0 `export const metadata` across `src/app/app/**`), so
they cannot set Next's static per-route metadata — and nothing set
`document.title` at runtime either (repo-wide grep for `document.title` returned
nothing).

Result: the browser tab, back/forward history entries, and bookmarks read the
same undifferentiated "Scout — Personalized AI news…" for Brief, Profile,
Interests, Skills, Settings, Connect, Chat, Liked stories, and the interest
detail screens. Two open Scout tabs are indistinguishable, and a screen reader
announces the **same** document title on every client-side navigation — removing
a primary wayfinding cue. WCAG 2.4.2 *Page Titled* expects each route to have a
descriptive title. This is the same class of issue tracked for the *other*
product as `[QPv8-design] … per-route document title` (that issue's body is
explicitly scoped to `airbnb-assistant`/`index.html`) — Scout had no equivalent
filed.

**Fix (this pass):** added one new file,
`src/app/app/layout.tsx` — a pass-through **client** layout that wraps the route
tree and sets `document.title` from `usePathname()` after navigation
(`"<Label> · Scout"`, longest-prefix match so `/app/profile/interest` → "Interest").
Labels mirror the in-app nav wording. No existing file changed; each page still
renders its own `AppNav`, so the layout only adds the title effect. Fully
reversible — delete the file to restore prior behavior.

Verification: `pnpm typecheck` clean; `pnpm lint` 0 errors (pre-existing
`<img>`/unused-var warnings unchanged); `pnpm build` succeeds, all 12 routes
prerender as static — the new layout does not break `output: export`.

## Checked and OK (no action)

- **Contrast:** re-confirmed against prior passes' hand-computed values; light/dark
  `text-muted` clear AA on paper/page/surface-muted. Not re-chased.
- **Accessibility hygiene:** app-wide focus rings, `prefers-reduced-motion`,
  44px targets, `role="switch"` Toggle, labelled icon-only controls, `Field`
  label association, Escape-closes-dropdowns — all still hold.
- **Error/empty/loading:** shared `ErrorBanner` (actionable per-error-class copy),
  `EmptyState`, `Banner`, and skeletons remain consistent and first-class.
- **Copy / brand:** editorial voice consistent; no placeholder/"coming soon"/lorem
  in Scout surfaces; route-aware 404. Marketing landing on-brand.
- **`global-error.tsx`:** hardcoded light-theme inline colors are acceptable for a
  root boundary that replaces `<html>` and cannot use the CSS-variable theme.

## Not re-filed (already tracked — verified by file path, this repo)

These open `[QP*]` issues reference **Scout** `src/...` paths and stand; left for
the Engineer, not duplicated:

- **a11y: global-nav dropdowns declare `role="menu"` without its keyboard model**
  (`AppNav.tsx`) — filed by AIR-227.
- **`[QPv8-design]` /app/connect pairing-token inputs have no label**
  (`src/app/app/connect/page.tsx:406-413,444-451`).
- **`[QPv8-design]` connect-page terminal block hardcodes hex**
  (`src/app/app/connect/page.tsx:563-577`).
- **`[QP-design]` sub-12px tiny type in chat/profile cards**
  (`ChatActionCard` / `ChatDeleteConfirm` / `ChatDock`).
- **`[QPv8-design]` route-level page titles drift off the type scale**
  (profile/skills/connect/interest H1s).
- **`[QP-design]` empty-feed CTA says "open the profile menu" but the control is
  labeled "Open settings"** (`src/app/app/page.tsx`).
- **AIR-213** Brief "Copy as Markdown"; **AIR-210** Companion Disconnect/re-pair;
  **AIR-100** "Manage interests" dead-end — Scout backlog.

## Genuinely a different product (correctly not in scope)

`[QP*]`/`[QPv*]` issues whose bodies reference `src/app/router/*`, `index.html`,
`DashboardLayout`, competitors/calendar/property cards, or "Hostly"/"Airbnb
Assistant" belong to **airbnb-assistant**; none of those components exist here.
