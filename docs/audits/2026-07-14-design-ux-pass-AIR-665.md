# AIR-665 Design / UX Audit

Date: 2026-07-14

Scope: this workspace's branch (`air-441/unify-assignment-copy`, PR #22) had
drifted again — this time worse than the AIR-630 cycle. No paid Apify scrape
was run.

## Summary

**The AIR-637 process gap (workspace never fetches before auditing) recurred,
one cycle later, in a worse form.** AIR-630 found local `main` 42 commits
behind `origin/main` and filed AIR-637 to fix it. That ticket is still
`backlog`/unassigned. This cycle, `git fetch origin` showed **this branch's
own remote counterpart** (`origin/air-441/unify-assignment-copy`) had moved
44 commits ahead of the local checkout — someone had already merged
`origin/main` into this branch remotely (`75f9d72 Merge branch 'main' into
air-441/unify-assignment-copy`) and pushed it, but the local working copy
never picked it up. So it wasn't just `main` that was stale this time; this
audit's own branch was behind its own remote.

Verified `HEAD` (`5a9bbbf`) was a strict ancestor of the remote tip (no
divergent local commits), so this was fixed with a plain fast-forward — no
rebase, no force-push, no PR content touched:

1. Found a pre-existing uncommitted local edit to `pnpm-lock.yaml` (present
   before this session started) that reintroduced the old `pnpm.overrides`
   block AIR-624/AIR-529 had already migrated off of — almost certainly local
   drift from an `install` run under a different pnpm version. Stashed it,
   fast-forwarded, confirmed the incoming committed lockfile superseded it
   (no longer matched, would have been a regression), and dropped the stash.
2. `git merge --ff-only origin/air-441/unify-assignment-copy` — clean,
   105 files, no conflicts.
3. `pnpm test` (hermetic `@scout/agent` suite): **188/188 green** post-merge.

While inspecting local git state, also found two **pre-existing, unrelated
`git stash` entries** left over from earlier sessions, each parked on the
wrong branch:
- `qpv11/air-453-connect-save-empty-token` had a stash containing AppNav
  ARIA/keyboard-focus WIP (AIR-407 territory), not anything about the Save
  button.
- `a11y/air-435-interestdoccard-role-link` had a stash explicitly labeled
  "unrelated themetoggle wip" touching `ThemeToggle.tsx`.

Both branches' *actual* committed fixes (`9eb30ca` for AIR-453, `a57b8b1` for
AIR-435) are intact, correct, and already pushed — the stray stashes are just
orphaned WIP from a session that had the wrong branch checked out. Left both
stashes untouched (did not pop/apply — that would corrupt those branches);
flagging here so nobody applies them by mistake.

## Findings

### Closed: AIR-274 (HIGH) — `bg-surface-strong` token now defined
Re-verified directly against the now-current branch content: `globals.css`
defines `--bg-surface-strong` in both light (`#e8dfcd`) and dark (`#2e2920`)
scopes, mapped through `--color-surface-strong` (landed via PR #9,
`584935c`, already merged to `origin/main`). All four call sites
(`RunScopeSelector`, `AppNav`'s "Run now" button, `Chip`) now resolve to a
real fill. Closed as **done**.

### Still open, re-confirmed against current code (not re-filed)
Read the live files directly rather than trusting ticket status, since two of
these ("in_review") turned out to have real fixes sitting on unmerged
branches rather than being stale:

- **AIR-407 / AIR-237** (AppNav dropdown ARIA menu semantics) — `AppNav.tsx`
  still declares `role="menu"`/`role="menuitem"` with only Escape + outside
  click handled, no arrow-key roving focus. AIR-407 is `in_review` — real
  work exists (see stash note above, though that stash is WIP *beyond* what's
  committed) but isn't merged. Not closing AIR-237 as a duplicate until
  AIR-407 actually lands on `main`.
- **AIR-262** — feed-filter/settings menu active items still convey state via
  color + `aria-hidden` checkmark only; grepped `AppNav.tsx` for
  `aria-current`/`aria-checked` — zero matches.
- **AIR-373 / AIR-392** — `connect/page.tsx` still has no
  `aria-live`/`role="status"`/`role="alert"` anywhere (grepped the file,
  confirmed zero occurrences); connection-status and generate-flow messages
  are silent to screen readers.
- **AIR-435** (HIGH) — `InterestDocCard.tsx` still wraps the whole card in
  `role="link" tabIndex={0}` around nested interactive children. Status
  `in_review`; the fix is actually done and pushed
  (`a11y/air-435-interestdoccard-role-link@a57b8b1`), just unmerged. Not a
  stale finding — a merge-backlog item (see AIR-643 comment below).
- **AIR-453** — Connect "Save" button still has no `disabled`/empty-state
  handling in the current branch content (`handleSaveToken` unconditionally
  saves and both `<Button variant="primary" onClick={handleSaveToken}>`
  instances are unconditionally enabled). Status `in_review`; likewise
  already fixed and pushed (`qpv11/air-453-connect-save-empty-token@9eb30ca`),
  just unmerged.

### No new UX findings from the ~30 commits merged since AIR-630
Reviewed every commit between the AIR-630 audit point (`ace4b75`) and current
`origin/main` for design relevance. All of them (AIR-425 abortable confirms,
AIR-509 stale-banner/rewrite-lock fixes, AIR-611 live Undo for
confirmed rewrite/delete, AIR-646 optimistic-like fix, AIR-645 confirm-state
fixes, AIR-644 "last good brief from `<date>`" fallback copy, AIR-107 chat
turn fixes, CAR-179 heading-order fix) are bug fixes or copy/UX
*improvements* reusing already-audited, tested components (e.g. AIR-611's
Undo reuses the existing `ChatActionCard`/undo channel rather than
introducing new UI) — none introduce a new surface that needs a fresh a11y
pass, and none regress anything previously fixed.

## Issue Hygiene

- **AIR-274** → **done** (see above).
- **AIR-637** (workspace-fetch process gap) → left open, but commented with
  evidence this recurred in a worse form and bumped **medium → high**: two
  audit cycles in a row have now lost real time to a stale checkout, and this
  time the drift affected the audit's own working branch, not just a
  read-only reference.
- **AIR-643** (Engineer, blocked, "rebase/merge PRs #9/20/21/22/24") —
  commented with confirmed evidence from this pass: PR #9 (AIR-274) and PR
  #24 (CAR-179) are **already merged** into `origin/main` (verified via
  `git log`, not assumed), so that ticket's list is partly done. Also
  surfaced two *additional* ready-to-merge branches not on its list —
  `a11y/air-435-interestdoccard-role-link` (`a57b8b1`) and
  `qpv11/air-453-connect-save-empty-token` (`9eb30ca`) — both still unmerged
  as of this pass.

## Not Re-filed

Everything in AIR-630's "Not Re-filed" list not already covered above
(AIR-247/391 duplicates already closed; backlog items AIR-261, 275, 276, 277,
278, 334, 347, 348, 486, 487, 542–546) — no new signal this cycle; none
touched by the last 30 merges into `origin/main`.

## Verification

- `git fetch origin`; `git merge-base --is-ancestor HEAD
  origin/air-441/unify-assignment-copy` (confirmed strict fast-forward before
  merging); `git merge --ff-only origin/air-441/unify-assignment-copy` (clean,
  no conflicts, no rebase, no force-push).
- `git show origin/main:<path>` / direct reads of the now-current branch
  content for `globals.css`, `AppNav.tsx`, `connect/page.tsx`,
  `InterestDocCard.tsx` to verify each finding above against real code, not
  memory or ticket status.
- `pnpm test` (hermetic `@scout/agent` unit + `/v0` contract suite):
  **188/188**, no regressions, run after the fast-forward.
- This pass's only source-tree change is this fast-forward (identical to
  what was already on `origin/air-441/unify-assignment-copy`) plus this doc;
  PR #22's own diff is untouched.
