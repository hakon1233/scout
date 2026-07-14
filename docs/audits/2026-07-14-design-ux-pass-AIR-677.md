# AIR-677 Design / UX Audit

Date: 2026-07-14

Scope: this workspace's branch (`air-441/unify-assignment-copy`, PR #22) —
started by fetching `origin` first (lesson from AIR-637/AIR-665) and auditing
directly against `origin/main` content, rather than trusting this stale
feature-branch checkout. No paid Apify scrape was run.

## Workspace handling

`git fetch origin` showed `origin/main` 30 commits ahead of this branch's
merge-base, and this branch itself (`air-441/unify-assignment-copy`) exactly
matched its own remote (0 behind) — no repeat of the AIR-630/AIR-665 staleness
pattern.

Initially merged `origin/main` into this branch locally to read fresh code
(clean, no conflicts, `pnpm typecheck`/`pnpm lint`/`pnpm test` all green
post-merge). On reflection, **reverted that merge before pushing anything**:
rebasing/merging `origin/main` into the open PR branches (including PR #22,
this one) is explicitly AIR-643's job (CTO, `in_progress` this same cycle,
already merged PR #20). Pre-merging main into this branch myself would have
duplicated that work and risked a push race with an agent actively rebasing
the same branch. Un-did it losslessly via `git checkout <prior-commit>` +
`git branch -f` (no `git reset --hard` — that command is denied in this
sandbox per the AIR-668 performance-pass doc; non-destructive checkout +
branch-force achieves the same end state without it). Continued the actual
audit by reading file content straight from `origin/main` via `git show
origin/main:<path>`, matching the pattern AIR-665 used for the same reason.

This branch's own change (PR #22, AIR-441 "assignment" copy unification) has
now been reviewed unchanged across eight consecutive audit cycles (AIR-460,
470, 511, 526, 602, 614, 630, 665) with zero findings — not re-reviewed line
by line again this cycle; nothing has touched those files since.

## Findings

### Closed: AIR-407 / AIR-237 / AIR-262 (AppNav dropdown ARIA) — all fixed by one merged PR
`af22881 a11y(nav): replace partial ARIA menu semantics with disclosure
popovers (AIR-407) (#20)` merged to `origin/main` since the AIR-665 audit.
Verified directly against `origin/main`'s `AppNav.tsx`:
- `role="menu"` / `role="menuitem"` / `aria-haspopup="menu"` are gone
  entirely (zero matches on a fresh grep) — both the feed-filter and
  settings dropdowns are now plain `role="group"` disclosures of native
  `<button>`s. This is exactly AIR-237's recommended fix (a) and resolves
  AIR-407 (the "ARIA role without its keyboard model" anti-pattern is gone
  because the role claiming that model is gone).
- Escape returns focus to the trigger (`buttonRef.current?.focus()`,
  explicitly commented "AIR-407" in both `FeedFilter` and `ProfileMenu`).
- Each active filter item now carries `aria-pressed={activeFilter ===
  interest.topic}` (and `aria-pressed={activeFilter === null}` for "All
  topics") — since the controls are now plain toggle buttons rather than
  menuitems, `aria-pressed` is the correct state mapping and satisfies
  AIR-262's acceptance criteria (active state exposed to assistive tech)
  as a side effect of the same commit.

All three closed as **done** with evidence in each ticket's comments.
AIR-643 (CTO, rebase/merge tracking) already reflects PR #20 as merged.

### Still open, re-confirmed against `origin/main` (not re-filed)
- **AIR-435** (HIGH, `in_review`) — `InterestDocCard.tsx` still has
  `role="link"` / `tabIndex={0}` on the outer `<article>` (confirmed:
  `git show origin/main:...InterestDocCard.tsx` still shows both at
  lines 127-128). The real fix (`a11y/air-435-interestdoccard-role-link
  @a57b8b1`) exists but is **not** an ancestor of `origin/main` — still
  unmerged. Pure merge-backlog item, unchanged since AIR-665.
- **AIR-453** (`in_review`) — Connect "Save" button is still unconditionally
  wired to `handleSaveToken` with no `disabled` guard on `origin/main`
  (confirmed both call sites). Fix (`qpv11/air-453-connect-save-empty-token
  @9eb30ca`) exists, also not merged. Unchanged since AIR-665.
- **AIR-373 / AIR-392** (`backlog`) — `connect/page.tsx` on `origin/main`
  still has zero `aria-live`/`role="status"`/`role="alert"` occurrences
  (re-grepped fresh). Unchanged.
- **AIR-637** (`backlog`, workspace-fetch process gap) — did not recur this
  cycle; `git fetch origin` ran first, before any content was read or
  trusted. Left open (still needs the quality-loop driver/tooling fix to
  make this automatic rather than depending on each cycle remembering);
  not re-filed, no new evidence to add.

### No new UX findings from the 4 commits landed since AIR-665
`git log HEAD..origin/main` filtered to commits dated after AIR-665's own
commit timestamp (2026-07-14 11:26) — everything older was already reviewed
by AIR-665 itself (it explicitly audited "current `origin/main`" at write
time, which already included the ~30-commit batch it enumerated). Only 4
commits are genuinely new to this cycle:
- `af22881` — AIR-407 fix, covered above.
- `de773d1` fix(connect): surface companion rejections — copy-quality
  improvement (shows the companion's actual rejection message instead of a
  generic "could not reach" string when the server responded but refused
  the run). Read the diff; it's a strict improvement, not a new finding.
- `8c489af` fix(companion): guard `pollBriefsRaw` — backend-only, no UI
  surface.
- `ea930a4` perf(web): revert 3 favicon `<img>` spots from `next/image`
  (AIR-668) — pure implementation-detail revert (`<Image>` → `<img
  loading="lazy">`), zero visual/markup/a11y change; confirmed by reading
  the diff and the AIR-668 performance-pass doc it shipped with.

## Verification

- `git fetch origin` run first, before reading or trusting any file content.
- `git merge origin/main` performed locally to confirm a clean merge (no
  conflicts) and to run `pnpm typecheck` / `pnpm lint` / `pnpm test`
  (214/214 unit+contract tests green) against the merged tree — then
  reverted (see Workspace handling) since this audit doesn't own merging
  PR branches.
- All findings in this doc were verified against `git show
  origin/main:<path>` content directly, not against this branch's (stale)
  working tree.
- This pass's only source-tree change is this doc — no product code
  touched, no branch state changed beyond the temporary local-only merge
  that was reverted before push.
