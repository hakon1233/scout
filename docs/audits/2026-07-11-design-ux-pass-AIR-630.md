# AIR-630 Design / UX Audit

Date: 2026-07-11

Scope: this workspace's branch (`air-441/unify-assignment-copy`, PR #22) has
been byte-identical since the AIR-602 pass two days ago, and AIR-460/470/511/
526/602/614 already walked it route-by-route and component-by-component six
times running, all converging on zero new findings. Rather than a seventh
identical walk, this pass first checked *why* six audits in a row found
nothing new — and found the actual cause. No paid Apify scrape was run.

## Summary

**Headline: this audit lineage's local `main` was 42 commits behind
`origin/main` — most likely because nothing in the six prior cycles ever ran
`git fetch`.** `git log --oneline main..origin/main` shows real,
design-relevant work that shipped to `origin/main` between 2026-06-27 and
today and was never seen by this audit chain: `CAR-272` (fixed the exact
pairing-token accessible-name bug this lineage had filed three separate times
— see below), `CAR-396` (consolidated hand-rolled empty states onto a shared
`EmptyState` primitive), `PER-262` (fixed `AppNav`'s filter-menu viewport
overflow), `PER-264` (raised `--accent-signal` from 3.89:1 to 4.85:1 to clear
AA), `AIR-527` (cross-tab/same-tab `ThemeToggle` sync), `AIR-512` (respects
`prefers-reduced-motion` on the chat scroll pill), and — merged in the last
hour, literally as this audit started — `AIR-624`, this lineage's own CI
lockfile fix. None of that is a *new bug*; it's six audits' worth of "no new
findings" that were actually "no new findings in a snapshot that stopped
moving." `origin/main` is what's live; auditing a frozen local ref isn't
auditing the product. Filed as a small process issue below (**AIR-637**) so
the next cycle fetches before it audits, not after.

Given that, this pass re-based its review on `origin/main`'s actual current
UI (via `git diff`/`git show`, read-only — this workspace's own branch was
**not** touched, so PR #22 is unaffected) instead of re-walking the stale
local tree. Two concrete outcomes:

1. **Three open tickets were stale, not the code.** AIR-405 (my own filed
   issue), plus its two earlier duplicates AIR-247 and AIR-391, all asked for
   an accessible name on the two `/app/connect` pairing-token inputs. `CAR-272`
   (`824709f`, already on `origin/main`) added `aria-label="Pairing token"` to
   both — as a side effect of an unrelated error-leak fix, under a different
   ticket, which is exactly how this kind of tracking drift happens. Verified
   directly by reading the current file; both inputs now have a real
   accessible name. Closed all three as done/duplicate (see Issue Hygiene).
2. **One new, small, real finding**: `origin/main`'s `connect/page.tsx:148`
   renders a plain-text error string containing literal Markdown backticks —
   see **AIR-638** below.

Everything else this pass checked against the current `origin/main` code
(AppNav's `ProfileMenu`/`FeedFilter` keyboard model, the `Save`-on-empty-token
dead affordance, connect-flow status announcements, the still-undefined
`bg-surface-strong` token) remains genuinely open and unfixed — confirmed by
reading the live files, not assumed from memory. Not re-filed; see below.

`pnpm test` (hermetic `@scout/agent` suite): 143/143, unchanged.

## Findings

### P3: Raw Markdown backticks render literally in a Connect error message
`origin/main:src/app/app/connect/page.tsx:148` — the "could not reach
companion" error string is plain JSX text (not Markdown-rendered):
```
"Could not reach the companion. Make sure `scout-agent run` is running on this machine."
```
Grepped the rest of the file for the same pattern; every other backtick is
inside a source comment, not user-facing text — this is the only offender.
Users will see literal backtick glyphs around "scout-agent run" instead of
code styling. Small, cosmetic, on the error path (so not rare — this is what
a user without the companion running sees on first Generate attempt). Filed
as **AIR-638**, routed to whoever owns `connect/page.tsx` next (Designer or
Engineer) — trivial string edit, wrap in `<code>` or drop the backticks.

### Process: audit workspace didn't track `origin/main` for 6 cycles
See Summary. Filed as **AIR-637**, routed to Engineer/CTO (quality-loop
workspace setup, not product code) — recommend the Design/UX audit step (or
the shared quality-loop driver) run `git fetch origin` and diff against
`origin/main` at the start of each cycle, independent of whatever branch the
workspace happens to have checked out for in-flight PR work.

## Issue Hygiene (closed, not new findings)

- **AIR-405** (mine, in_review, no active PR/checkout) → **done**. Its own
  acceptance criteria are met by `CAR-272`'s `aria-label="Pairing token"` on
  both connect-page password inputs, verified on `origin/main`.
- **AIR-247** (backlog, unassigned) → **done**, duplicate of AIR-405, same
  fix.
- **AIR-391** (backlog, unassigned) → **done**, duplicate of AIR-405, same
  fix.

## Not Re-filed

Confirmed still open and still accurate against current `origin/main` code
(read the live files, not re-flagged from memory):

- **AIR-274** (HIGH) — `bg-surface-strong` still absent from
  `globals.css` (`grep surface-strong` → no match). PR #9 already fixes it
  and is CI-green; still unmerged. See AIR-624/AIR-631 re: why PRs stall.
- **AIR-407 / AIR-237** — `AppNav`'s `ProfileMenu` still declares
  `role="menu"`/`role="menuitem"` with click-only interaction, no arrow-key
  roving-tabindex model.
- **AIR-262** — `FeedFilter`'s topic menu items still convey the active
  selection with color + a `aria-hidden` checkmark only, no `aria-checked`/
  `aria-current`.
- **AIR-373 / AIR-392** — connect-flow status text (`genMsg`) still has no
  `aria-live`/`role="status"`, confirmed on the current file.
- **AIR-435** (HIGH) — `InterestDocCard` still nests an `<a>` and a `<button>`
  inside a `role="link"` article; only the Markdown renderer changed
  underneath it, not the semantics.
- **AIR-453** — `Save` in the connect flow is still un-disabled on an empty
  token field (`handleSaveToken` just silently no-ops).
- AIR-237, 261, 275, 276, 277, 278, 334, 347, 348, 486, 487, 542–546 — all
  `backlog`/unassigned, none touched by the last 6 weeks of merges into
  `origin/main`; no status change needed.

## Verification

- `pnpm test` (hermetic `@scout/agent` unit + `/v0` contract suite): 143/143,
  no regression.
- `git fetch origin`, then `git log --oneline main..origin/main` /
  `git diff main..origin/main --stat` to enumerate what shipped unaudited;
  `git show origin/main:<path>` / `git diff main..origin/main -- <path>` to
  read the current UI code for `AppNav.tsx`, `ThemeToggle.tsx`,
  `connect/page.tsx`, `liked/page.tsx`, `InterestDocCard.tsx`, `FeedView.tsx`,
  `globals.css`, `error.tsx`, `ui/README.md`, and the diffs for `page.tsx` /
  `ChatDock.tsx` (confirmed the large refactor there is a pure JSX
  relocation — every `aria-*`/`role`/`disabled` attribute present before is
  present after, no regression).
- This workspace's own branch/PR #22 was not modified or rebased by this
  pass — only read against `origin/main` via git plumbing. No product source
  changed; only this audit doc is new in this branch.
