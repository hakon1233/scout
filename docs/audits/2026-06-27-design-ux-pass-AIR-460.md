# Design / UX audit pass — AIR-460 (2026-06-27)

Recurring Quality-Loop design/UX pass on **Scout** (personalised AI news
platform; editorial "private wire service" brand — warm-paper canvas, ink
type, signal-red dateline accent, editorial serif). Scope: accessibility
(labels, keyboard operability, contrast), error/empty/loading states, dead or
misleading affordances, copy quality, and off-brand styling.

## Method

- Read the full UI surface: `src/app/layout.tsx`, `src/app/page.tsx` (landing),
  `not-found.tsx`, `global-error.tsx`, every `src/app/app/**/page.tsx` (chat,
  connect, interests, interests/interest, liked, profile, profile/interest,
  settings, skills, `/app` root), and all of `src/components/**` including
  `ui/`, `profile/`, `skills/`.
- Read the design-token contract in `src/app/globals.css` and checked component
  code for raw ramp utilities / hardcoded hex / off-scale type.
- Two independent audit sweeps (a11y + affordances; copy + states + brand),
  each cross-checked against the open-issue list to avoid re-filing.

## Result: saturated coverage — no new fix-issues warranted

Every concrete defect surfaced this pass is **already tracked by an open
issue**, or — on verifying the code — is **already handled**. Prior recurring
passes (QPv7–v11 design series) have comprehensively captured this product's
design/UX debt. Per the issue's own guardrail ("don't re-file items already
tracked by an open issue… focus on what genuinely moves the needle"), no new
issues were opened.

### Findings surfaced → already tracked

(Identifiers verified against the live issue list.)

| Finding | Tracked by |
|---|---|
| Landing masthead "Privacy" link jumps to feature pills, not a privacy section | **AIR-348** |
| Connect pairing-token inputs have no accessible name / placeholder-only label | **AIR-405**, **AIR-391**, **AIR-247** |
| Connect "Save" button no-ops on an empty token field (dead affordance) | **AIR-453** |
| Connect-page terminal block hardcodes hex instead of tokens (breaks dark mode) | **AIR-261** |
| App-shell logo `hover:scale-105` not motion-safe / only scale-transform in app | **AIR-347**, **AIR-360** |
| Tiny `text-[9px]`/`text-[10px]` type in chat/profile cards (resize/legibility) | **AIR-277** |
| `global-error` crash screen is light-only (dark-mode flash) | **AIR-334** |
| Generic "Something went wrong" global-error copy (not editorial/actionable) | **AIR-440** |
| BriefHistory pager swallows fetch errors → shows "No previous briefs yet" | **AIR-330** |
| Connect status / generate-flow messages not announced (no live region) | **AIR-392**, **AIR-373** |
| Full-page / shell loading spinners silent to assistive tech | **AIR-290**, **AIR-359** |
| No "Skip to main content" bypass-block | **AIR-358** |
| Static / off-scale per-route document titles | **AIR-304** |
| ThemeToggle radiogroup without arrow-key operability | **AIR-442** |
| Global-nav dropdowns `role="menu"` without keyboard model (AppNav) | **AIR-237** |
| App-wide `prefers-reduced-motion` support | **AIR-360** |
| Theme `color-scheme` hydration mismatch / stale-paint | **AIR-408**, **AIR-291** |
| `bg-surface-strong` undefined token (selected/active fills) | **AIR-274** |
| Chat docs scrim hardcodes `rgba(28,26,23,0.28)` instead of a token | **AIR-276** |
| Filtered-feed generic empty + no in-place clear-filter | **AIR-332** |
| Liked stories empty state has no CTA back to the brief | **AIR-423** |
| Empty-feed CTA says "open the profile menu" but control is "Open settings" | **AIR-278** |
| InterestDocCard nests link+button inside a `role="link"` article | **AIR-275**, **AIR-435** |
| Feed-filter & settings menus don't expose selected item to AT | **AIR-262** |
| Interest "intent doc" object has four inconsistent names | **AIR-441** |

### Candidates that turned out to be non-defects (verified in code)

- **Connect generate-flow error/done copy lacks a next step** — *false alarm.*
  `src/app/app/connect/page.tsx:335–380` already renders actionable CTA links
  next to the message: "Set your interests first →" on the
  `error && !hasInterests` branch and "Go to brief →" on the `done` branch.
- **`LikeButton` icon-only control without a name** — *already correct.*
  `src/components/LikeButton.tsx` sets `aria-label` ("Save to liked stories" /
  "Remove from liked stories") and `aria-pressed`.
- **Connect status pill warning contrast** — `text-warning` (`#7a5a1e` light /
  `#d8bd86` dark) on `bg-page` clears WCAG AA for the small all-caps status
  line. The recently-landed AIR-406 amber "reachable · pairing needed" state
  reads correctly.

### Off-scale type on landing/connect mastheads — intentional, not filed

`src/app/page.tsx` and the connect masthead use a few arbitrary sizes
(`text-[12px]`, `text-[34px]`, `text-[40px]`) for the hand-tuned editorial
hero. These are deliberate brand-display choices outside the app type scale and
do not affect legibility or accessibility; filing them would be churn, not
signal.

## Disposition

No code change required. Build/lint/tests untouched (doc-only). The open
issues above remain the actionable backlog for this product's design/UX; the
highest-leverage clusters are the **Connect-flow a11y** group
(AIR-405/391/392/373) and the **off-brand token** group
(AIR-274/261/276/277).
