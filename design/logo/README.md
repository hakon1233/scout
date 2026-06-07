# Scout logo concepts (PER-220)

Five distinct directions for the Scout mark, on the warm-paper editorial brand.
The founder picks one; the chosen SVG drops into the **PER-219** header slot.
No logo is wired into the app here — this is a selection exercise only.

## Brand tokens used
- Paper `#f6f2ea` · ink `#1c1a17` · signal-red `#9a3b2e` · line `#d8d0c1`
- Display type: **Fraunces** 600 (wordmarks)

## Concepts

| # | Name | What it says |
|---|------|--------------|
| 01 | **Dateline Wordmark** | Type-first masthead. Scout is a publication, not an app. Red full-stop = the signal. |
| 02 | **Trail Monogram** | An "S" as a scouting trail ending in a signal-red node. Strongest app-icon. |
| 03 | **Compass Star** | Four-point navigation star, north in signal-red. The scout knows which way to look. |
| 04 | **Signal Arcs** | A wire-service transmission from one source. Scout brings back just the signal. |
| 05 | **Spyglass** | The scout spots distant news; the lens catches the signal (red). |

## Files
- `svg/` — vector source. Each concept has a colour lockup/mark and an `-mono` (ink-only) variant.
- `png/contact-sheet.png` — all concepts side by side (the comparison artifact).
- `png/concept-0N-preview.png` — per-concept: 28px header sim + large colour + ink-only.

## Production note
Wordmark SVGs reference the `Fraunces` font with a serif fallback. Previews are
rendered with the real webfont. When a concept is chosen, outline the wordmark to
paths in PER-219 so it renders identically without a font dependency.

## Regenerate previews
```
node _build/gen.mjs   # rebuilds the HTML render pages from svg/
# then headless-Chrome screenshot _build/*.html into png/
```
