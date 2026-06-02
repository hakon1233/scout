# Scout UI primitives (PER-9 seed)

The MVP UI is built on a small set of primitives and a token layer in `src/app/globals.css`. Component code must never reach into primitive ramps (`zinc-*`, `red-*`, …) — only semantic tokens or the primitives below.

## Tokens

All tokens live in `src/app/globals.css`. Light values are defined under `:root`; dark values swap via `@media (prefers-color-scheme: dark)`. There is no user-facing toggle yet (see PER-7j).

### Color (semantic)

| Token             | Tailwind utility           | Purpose                            |
| ----------------- | -------------------------- | ---------------------------------- |
| `--bg-page`       | `bg-page`                  | App background                     |
| `--bg-surface`    | `bg-surface`               | Cards, inputs, default panels      |
| `--bg-surface-muted` | `bg-surface-muted`      | Inline muted surfaces              |
| `--border-default` | `border-border-default`   | Default 1px borders                |
| `--border-strong` | `border-border-strong`     | High-contrast borders              |
| `--text-primary`  | `text-primary`             | Default body text                  |
| `--text-secondary` | `text-secondary`          | De-emphasized supporting text      |
| `--text-muted`    | `text-muted`               | Captions, meta                     |
| `--accent-bg`     | `bg-accent`                | Primary action background          |
| `--accent-fg`     | `text-accent-fg`           | Primary action foreground          |
| `--accent-bg-hover` | `bg-accent-hover`        | Primary action hover               |
| `--danger-*`      | `bg-danger-bg` / `bg-danger-bg-hover` / `text-danger` / `border-danger-border` | Error surfaces + destructive-action buttons |
| `--info-*`        | `bg-info-bg` / `text-info` / `border-info-border` | Info banners |
| `--success-*`     | `bg-success-bg` / `text-success` / `border-success-border` | Success banners |
| `--warning-*`     | `bg-warning-bg` / `text-warning` / `border-warning-border` | Warning banners |
| `--focus-ring`    | `ring-focus-ring`          | Focus ring color (`focus-visible:ring-2`) |

### Space (4px base)

`--space-1` … `--space-12` (0.25rem → 3rem). Tailwind's stock `p-*` / `gap-*` utilities share the same step.

### Radius

`--radius-sm` (0.25rem), `--radius-md` (0.5rem), `--radius-lg` (0.75rem), `--radius-pill` (9999px). Surfaced as `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill`.

### Type

`display`, `title-1`, `title-2`, `title-3`, `body`, `body-sm`, `caption`, `mono-xs`. Surfaced as `text-display`, `text-title-1`, … `text-mono-xs`. Sizes carry their own line-height / letter-spacing / weight where appropriate.

Font stacks: Geist (sans) and Geist Mono — `--font-sans` and `--font-mono`. The previous `body { font-family: Arial, … }` override has been removed.

### Motion

- `--motion-fast: 120ms`
- `--motion-base: 200ms`
- `--motion-emphatic: 320ms`
- Easing: `var(--motion-ease)`
- `prefers-reduced-motion: reduce` zeroes out transitions and animations globally.

## Primitives

Live in `src/components/ui/`. Re-exported from `src/components/ui/index.ts`.

### `<Button>`

```tsx
<Button variant="primary" size="md" loading={isSaving}>Save</Button>
```

- `variant`: `primary | secondary | ghost | link | danger`
  - `danger`: tinted secondary-destructive treatment for destructive actions (e.g. "Clear stored data"). Pairs with a confirm step — do not use for one-click destructive actions.
- `size`: `sm | md`
- `loading`: inline spinner, disables the button, sets `aria-busy`
- Renders a real `<button>`. For navigation, use `<Link>` with the same visual classes (see `src/app/page.tsx`).

### `<Field>`

```tsx
<Field label="Your name" value={...} onChange={...} helper="optional" />
<Field as="textarea" label="Interests" error="Add one" ... />
```

- Wraps `<input>` or `<textarea>` (`as="textarea"`).
- Wires `htmlFor` / `id`, `aria-invalid`, and `aria-describedby` for helper + error.
- Error state uses `--danger-border` automatically.
- Focus ring uses `--focus-ring`.

### `<Banner>`

```tsx
<Banner tone="danger">Anthropic key looks wrong.</Banner>
```

- `tone`: `info | success | warning | danger`
- `tone="danger"` → `role="alert"`; others → `role="status"`.

### `<Card>` / `<Section>`

```tsx
<Card padding="md" tone="default">…</Card>
<Card tone="muted" padding="sm">…</Card>
<Card tone="dashed" padding="lg">empty-state copy</Card>

<Section title="Sources" description="…" actions={<Button>…</Button>}>
  …content…
</Section>
```

- `Card`: `tone` = `default | muted | dashed`; `padding` = `none | sm | md | lg`. Uses `--bg-surface` and `--border-default`.
- `Section`: titled block with optional description + actions row.

## Rules

1. Component code uses **semantic** tokens only. Raw `zinc-*` / `red-*` Tailwind utilities are forbidden outside `globals.css`.
2. Add a variant to the existing primitive rather than re-creating button/field/banner shapes inline.
3. New semantic tokens get added under `:root` AND the dark `@media` block AND `@theme` in `globals.css`.
4. Dark mode is driven only by `prefers-color-scheme`. A user-facing toggle is tracked in PER-7j — do not introduce a `dark:` variant in component code.
