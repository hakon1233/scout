# Architecture & tech-debt review — 2026-06-26 (AIR-326)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this Quality Pass cycle (AIR-320…AIR-327)
and are deliberately left to them.

**Baseline: 130 agent tests pass (`pnpm test`), suite hermetic/offline. `tsc
--noEmit` clean, `eslint` 0 errors. One small clearly-safe fix made directly
(below); tree left green. No paid Apify scrape touched — this pass read code
only.**

## Overall read

The codebase remains healthy. The `@scout/agent` companion ↔ Next.js web split
holds; the prior architecture passes (AIR-188, CAR-132, AIR-206, AIR-204,
AIR-220, AIR-232, AIR-245, AIR-257, AIR-270, AIR-286, AIR-300, AIR-315) plus the
FLI-3xx hardening passes have swept the agent engine, the web glue, and the
device-local persistence layer.

The last two arch passes single-sourced web-side *read/transform* duplication:
the date formatter (AIR-300) and the interest slug (AIR-315). This pass closed
the matching gap on the *write* side: the localStorage write guard, which had
quietly grown to **four** hand-copies — three of which document, in prose, that
they must be kept in sync with the others by hand.

## Finding — fixed directly this pass (small, reversible)

**The localStorage write guard (SSR check + QuotaExceededError/SecurityError
swallow) was hand-copied across four write sites; three carried comments
explicitly naming the others as copies to keep in sync.**

The app persists to `window.localStorage` from four places. `setItem` throws
*synchronously* on `QuotaExceededError` (full store) and `SecurityError` (Safari
private windows, disabled/partitioned storage). On the current `main` all four
were already guarded — but as four separate copies:

- `src/lib/storage.ts` → `safeSet` — comment: *"Mirror of likes.ts `write()`."*
- `src/lib/likes.ts` → `write` — the original guarded write.
- `src/lib/companion.ts` → `saveCompanionToken` — guarded by **FLI-333**, with a
  comment: *"Swallow it like storage.ts `safeSet` and likes.ts `write`."*
- `src/components/ThemeToggle.tsx` → `setTheme` — a bare `try {} catch {}` with
  no comment.

FLI-333 had just finished closing the last *correctness* gap here (the companion
token write used to be unguarded and threw out of the pairing handler in Safari
private mode). But it closed it by adding a **third** hand-copy rather than
extracting — and its own comment enumerating the two sibling copies is the tell:
this is a guard everyone agrees is load-bearing, held together by copy-paste and
a promise to remember. A future change to the degradation policy (e.g. detect
quota and prune oldest, or log once for observability) would have to find and
edit four call sites or silently drift. This is the same "documented hand-mirror
→ single source" smell AIR-300 and AIR-315 fixed on the read side.

**Fix (committed):**
1. New pure module `src/lib/safe-storage.ts` exporting `safeSetItem(key, value)`
   — the SSR guard + try/catch-swallow write primitive, with one doc comment
   covering the two throw modes and the degrade-don't-throw contract.
2. `storage.ts` keeps `safeSet` as an alias (`const safeSet = safeSetItem`) so
   its three call sites and the `setBrief`-updater rationale are untouched —
   zero caller churn.
3. `likes.ts:write` routes its guarded `setItem` through `safeSetItem`; the
   surrounding cache-mutation + `notify()` ordering is unchanged (the primitive's
   SSR check is a no-op there since `write` already returns early on SSR).
4. `companion.ts:saveCompanionToken` routes through `safeSetItem`.
5. `ThemeToggle.tsx:setTheme` routes through `safeSetItem`, replacing the bare
   empty catch with the single-sourced, documented guard.

This is **behavior-preserving**: every site already swallowed the same throws,
so output is identical; the change collapses four copies into one. (The one
correctness improvement these guards exist for — the companion token — was
already shipped by FLI-333; this pass only removes the duplication FLI-333 left.)

Verification: `tsc --noEmit` + `eslint` clean; `pnpm test` 130/130; touched
files prettier-clean (the pre-existing prettier deviation in `likes.ts`'s
`parse()` one-liner — present on `main`, not in the CI gate — was left untouched
to keep the diff scoped). The web layer has no automated test (the known AIR-129
gap), so behavior-preservation rests on the move being a verbatim guard with
identical try/catch semantics across all four sites — confirmed by reading.

## Considered and deliberately left (NOT filed — too small / not clearly-safe)

- **`safeGetItem` / `removeItem` guards.** `storage.ts` and `likes.ts` also each
  guard `getItem`/`removeItem` with `typeof window` checks. Folding the *reads*
  is lower value (a read miss already returns `null`, the guards are trivial) and
  `likes.ts`'s read is entangled with its `cacheRaw` memoization, so it is not a
  clean mechanical extraction. The *write* guard was the one with a documented
  four-way mirror; the reads can wait for a future pass.

## Verified already-tracked — deliberately NOT re-filed

Confirmed still open and genuinely Scout-relevant this pass:

- **AIR-195** (high) — confirm-delete/rewrite TOCTOU vs. an in-flight chat turn.
- **AIR-196** — `readChatTranscript` blanket `catch { return [] }` wipes history.
- **AIR-197** — `server.ts` route-table / `withAuthedJson` refactor.
- **AIR-198** — shared `spawnClaude()` + chat per-session timeout + stdout cap.
- **AIR-177** — `/v0` 500 handler leaks `String(err)` to the client.
- **AIR-178** — unbounded chat transcript growth / whole-file poll read.
- **AIR-129** — no frontend test harness over the pure web seams.
- **AIR-179** — observability on best-effort cleanup catches.
- **AIR-272** — cross-package contract test pinning the web story-date parser to
  the agent's canonical token.
- **CAR-132 A/B/C** — server body-parse dedup, fire-and-forget observability,
  shared browser SSR-guard / abortable-effect hooks. *Note:* the write half of
  CAR-132 C (shared browser SSR-guard) is now realized by `safe-storage.ts`; the
  read/effect hooks remain.

## Note on concurrency

This pass was initially built on a stale local checkout and had to be rebased
onto the rewritten `main`, where **FLI-333** had concurrently hardened
`saveCompanionToken` (the correctness gap this pass first spotted independently).
The work was re-scoped on the live base to the remaining, still-valid
contribution: single-sourcing the four guard copies FLI-333 left behind. No
duplicate fix landed.

## Method

Grepped the tree for every `localStorage.setItem` across `src/`; found four write
sites; read each and confirmed all four were guarded but as separate copies,
three self-documented as mirrors. Extracted `src/lib/safe-storage.ts`, routed all
four through it, kept `storage.ts`'s `safeSet` name as an alias for zero caller
churn. Ran `tsc --noEmit` + `eslint` + `pnpm test` (130/130 green). No network
calls; no Apify scrape.
