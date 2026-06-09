# Chat redesign — Claude-Code-style reading column (PER-227)

Redesign of Scout's interest-doc management chat so it reads like the Claude Code
chat: a clean centered reading column, calm typographic messages (no chat bubbles
on the assistant side), an auto-grow composer, token streaming, and inline action
affordances — on **both** mobile and desktop. Pure presentation/UX. The run/interests
contract (`POST /v0/interests` + poll `GET /v0/briefs`), the 3-interest baseline, and
all persistence are **unchanged**.

## Surface / path note (read first)

The issue refers to `/app/profile`, but in the live code `/app/profile`
(`src/app/app/profile/page.tsx`) **redirects to `/app/settings`**. The actual chat
surface this redesign targets is **`/app/chat`** (`src/app/app/chat/page.tsx`), which
renders `ChatDock` + the docs workbench. FE should build against
`src/components/profile/ChatDock.tsx`. No change to routing is implied.

## Deliverables index

| File | What it is |
| --- | --- |
| `wireframe-desktop.html` | Annotated 1440×900 wireframe — two-pane shell, real tokens + fonts. |
| `wireframe-mobile.html` | Annotated 390×844 wireframe — two phone frames (chat tab + docs bottom-sheet). |
| `shots/desktop-1440.png` | Rendered screenshot of the desktop wireframe (visual-truth verified). |
| `shots/mobile-390.png` | Rendered screenshot of the mobile wireframe (visual-truth verified). |
| `README.md` | This file — token/spacing/state legend, action-mode spec, diff-card anatomy, contrast findings. |

Open the HTML files directly in a browser — they pull the real Google Fonts and inline
the live token values, so they are faithful previews, not abstract boxes. Numbered red
pins (1–8 desktop, A–E mobile) map to the annotation legend at the foot of each file.

## Layout

### Desktop (≥1024px)
- Single centered **reading column**, `max-width: 720px`, `margin: 0 auto`. This is the
  default when no doc is in focus.
- Where chat + docs coexist: **two-pane** — chat ≈62%, docs rail ≈38% (rail
  `min 380px / max 480px`), separated by a **1px `--line` (#d8d0c1)** vertical divider.
- The reading column stays centered *within* the chat pane so line length never exceeds
  the comfortable measure even on wide screens.

### Tablet (768–1023px)
- **Single column** (same centered reading column as desktop). The docs rail collapses
  behind the segmented **Chat | Docs** toggle (same control as mobile) — there isn't
  room for a persistent rail without crushing the measure.

### Mobile (<768px)
- Full-bleed, **16px** horizontal padding.
- Docs are **not** a side rail — they live behind a segmented **Chat | Docs** toggle at
  the top; tapping Docs raises a **bottom-sheet** (scrim + grab handle) over the chat.
- Composer is **sticky** to the bottom with
  `padding-bottom: max(12px, env(safe-area-inset-bottom))`.
- `<meta name="viewport" content="... interactive-widget=resizes-content">` so the
  keyboard resizes the layout instead of overlaying the composer.

## Message anatomy

**Assistant** — **no bubble.** Full-column typographic block in Newsreader
(`--font-reading`) 17px / line-height 1.6, ink `--ink (#1c1a17)`. Label row above:
JetBrains Mono, `--accent-signal (#9a3b2e)`, "SCOUT" + faint timestamp. This is the
editorial reading surface — treat it like body copy, not a UI chip.

**User** — quiet, left-aligned, faint `--bg-surface-muted (#efe9dd)` tint with a 1px
`--line` hairline and a small radius. Label row: JetBrains Mono `--text-muted`,
"YOU · 2:14 PM". Deliberately lower-contrast than the assistant turn so the eye rests on
Scout's output.

## Action modes

The current contract applies a `ChatChange` **after it is already durable on disk**
(see `src/lib/chat.ts`; PER-139 "no dead control"). There is no backend "propose /
pending" state. So the two action modes below have an honest v1 path and a full-target
path:

| Change type | Full target | **v1 (shippable now)** |
| --- | --- | --- |
| create / append / minor-edit | Auto-apply + **Undo** | ✅ Same — auto-apply, prominent Undo. |
| delete / full-rewrite | **Confirm before apply** (Apply / Discard) | Shown as a confirm-styled card, but because the change is already durable, "Apply" = keep / "Discard" = revert-via-Undo. True pre-apply hold needs a backend **"propose" mode** — filed as a separate FE/backend issue, out of scope here. |

The wireframes render **both** card styles (an applied create card and a confirm-style
delete card) so FE can build the visual states now and wire the real pre-apply hold when
the contract gains a propose state. **Do not** fake a pre-apply hold on the client by
withholding an already-durable change — that would desync the docs rail from disk.

## Diff-card anatomy

A proposed/recorded change renders as a **diff card**:
- **Header row** — op label in JetBrains Mono (`CREATED · EU AI ACT`,
  `REMOVE · CRYPTO MARKETS`) + a state chip on the right.
- **Body** — unified diff lines in JetBrains Mono (`--font-mono`). `+` lines get a
  success gutter (`--success-bg #e9efe4` / `--success-fg #3f5a32`); `−` lines get a
  danger gutter (`--danger-bg #f7e9e6` / `--danger-fg #8a2f23`).
- **Footer** — action buttons (Undo, or Apply / Discard) depending on mode.

**Card states:**
- **applied / resolved** — green "APPLIED" chip, Undo button, full opacity.
- **pending / needs-confirm** — amber "CONFIRM" chip
  (`--warning-bg #f6ecd6` / `--warning-fg #7a5a1e`), Apply + Discard buttons.
- **failed** — danger chip "FAILED", error line, Retry button; card border
  `--danger-border`.

**Tool output** lives in a **framed, collapsible** block: JetBrains Mono on
`--bg-surface-muted`, 1px `--line` border, a disclosure caret in the header. Reserved
for machine/tool output only — see the JetBrains Mono rule below.

**On Apply/auto-apply:** the matching docs-rail card (`InterestDocCard`) flash-highlights
via the existing `DocBeat` mechanism (`created` / `updated`), 6s. No new mechanism needed.

## Token / spacing / state legend (build to these — live values, not the issue's hexes)

> The issue quoted approximate hexes; these are the **authoritative live tokens** from
> `src/app/globals.css`. Use these.

| Role | Token | Value |
| --- | --- | --- |
| Paper / page bg | `--bg` / paper | `#f6f2ea` |
| Card bg | `--card` | `#fffdf8` |
| Tinted block (user msg, tool output) | `--bg-surface-muted` / `--paper-2` | `#efe9dd` |
| Hairline / divider | `--line` | `#d8d0c1` |
| Ink (assistant body) | `--ink` | `#1c1a17` |
| Ink secondary | `--ink-2` | `#46413a` |
| Muted / timestamp | `--text-muted` / `--ink-3` | `#6f685d` |
| Signal (accents, active, labels) | `--accent-signal` | `#9a3b2e` |
| Success gutter bg/fg/border | `--success-*` | `#e9efe4` / `#3f5a32` / `#c2d2b4` |
| Danger gutter bg/fg/border | `--danger-*` | `#f7e9e6` / `#8a2f23` / `#e0b3aa` |
| Warning (confirm) bg/fg/border | `--warning-*` | `#f6ecd6` / `#7a5a1e` / `#ddc89a` |

**Fonts:** `--font-serif` Fraunces (display only) · `--font-reading` Newsreader
(assistant/long-form) · `--font-sans` Inter (UI chrome) · `--font-mono` JetBrains Mono
(machine/tool output, labels, diffs — **never** body copy).

**Spacing:** 4px base scale. Reading column `max-width: 720px`. Prose measure `68ch`
(`.measure-prose`). Mobile gutter 16px.

**Motion:** fast 120ms / base 200ms / emphatic 320ms. All decorative motion (streaming
caret blink, flash-highlight, scroll pill) must have a `prefers-reduced-motion: reduce`
variant that drops to an instant/opacity-only state.

## Accessibility / contrast findings (WCAG 2.x)

- `--accent-signal #9a3b2e` on paper `#f6f2ea` = **6.19:1** → **PASS** AA body & large.
  Safe for the SCOUT label and accents.
- The issue's quoted timestamp `#8a7f6e` on paper = **3.52:1** → **FAILS** AA body (4.5:1).
  **Do not use it.** Use the live `--text-muted #6f685d` = **4.93:1** → **PASS**.
- Targets ≥44×44px (composer send/stop, toggle, card buttons).
- `role="log" aria-live="polite"` on the message list announcing **completed** turns
  only (not every token). Focus management: move focus to the confirm card on a
  needs-confirm change.

## Out of scope (flag, don't build here)

- Backend **"propose / pending"** change mode (enables true pre-apply hold for
  delete/full-rewrite). Filed for FE/backend.
- Any change to the run/interests contract, 3-interest baseline, or persistence.

## Synthetic data note

All example content in the wireframes is **synthetic** (EU AI Act enforcement, Fusion
energy, Crypto markets). No customer data.
