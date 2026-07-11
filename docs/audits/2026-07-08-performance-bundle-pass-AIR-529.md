# Performance & bundle-size pass - 2026-07-08 (AIR-529)

Recurring Quality-Loop performance pass. Next.js 16.2.6 / React 19, static
export (`output: "export"`).

## Headline: the last ~20 passes were auditing a stale, unmerged fork

The branch this pass started on (`air-437-briefhistory-fetch-error`, carrying
the AIR-173 → AIR-514 audit lineage back to AIR-204) is pushed to `origin` but
was **never merged into `main`**. `origin/main` moved on independently under
other tracks (CAR/FLI/PER and other AIR tickets) and is now 80 commits ahead
of that branch's base, with real content conflicts (`package.json`,
`src/app/app/page.tsx`, `useProfileWorkbench.ts`) — confirmed via a scratch
`git merge --no-commit` that was aborted, not applied.

Practical effect: every "source frozen, backlog exhausted" finding from
AIR-298 through AIR-514 was true for that isolated branch, but told us nothing
about the app users/CI actually build from. Fixes that branch believed were
shipped (AIR-173 poll backoff, AIR-175 fetch parallelization, AIR-194 markdown
code-splitting, the AIR-514 pnpm-11 install fix) were **not present on
`origin/main`**.

This pass abandoned that branch, opened a fresh branch directly off
`origin/main` (`air-529-performance-pass`), and audited/fixed the real trunk.
Two of the four gaps above (ChatDock retry, theme hydration suppression) had
already been independently re-implemented on trunk by other work and needed
no action; the pnpm fix, fetch-waterfall, poll-backoff, and markdown
code-splitting gaps were real and are fixed below.

**Follow-up filed:** reconcile or formally retire `air-437-briefhistory-fetch-error`
so future performance passes don't keep auditing it. See AIR-535.

## Fixed this pass

1. **pnpm 11 frozen-install break.** `package.json`'s `pnpm.overrides` field is
   no longer read by pnpm 11.9 (`[WARN] The "pnpm" field ... ignored`), and
   `pnpm install --frozen-lockfile` (what CI runs) failed outright with
   `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Moved the four overrides
   (`postcss`, `@babel/core`, `js-yaml`, `esbuild`) into
   `pnpm-workspace.yaml#overrides`, and added an explicit `allowBuilds` +
   `onlyBuiltDependencies` allowlist for the three packages that need
   postinstall scripts (`esbuild`, `sharp`, `unrs-resolver`) — pnpm 11 also
   started requiring per-package build approval, not just
   `onlyBuiltDependencies`, for non-interactive installs. Verified with a
   from-scratch `rm -rf node_modules && pnpm install --frozen-lockfile`.

2. **Waterfall fetch on the profile/interests load path.**
   `useProfileWorkbench.ts` awaited `fetchChatTranscript(tok)` then
   `fetchInterestsFull(tok)` in series; both depend only on the pairing token
   and are independent of each other. Parallelized with `Promise.all`,
   preserving the cancelled-guard and the sequential
   `fetchCompanionInterests` fallback (still gated on `full` being empty).
   Roughly halves the network-bound portion of first paint on `/app/interests`
   and `/app/profile`.

3. **Fixed 10s companion poll regardless of ready state.** `src/app/app/page.tsx`
   ran `setInterval(check, 10_000)` for the page's entire lifetime — steady
   `/healthz` + run-failure polling every 10s even once the companion was
   confirmed ready. Widened to 30s once `companionReady` is true (kept in the
   effect's deps so a drop-out flips it back to 10s within one tick). 3x fewer
   background network calls and main-thread wakeups once paired, no behavior
   change.

4. **Eager `react-markdown` + `rehype-sanitize` bundling on four reading-first
   surfaces.** `ChatMarkdown.tsx`, `InterestDocCard.tsx`,
   `InterestScopeView.tsx`, and the standalone `app/profile/interest/page.tsx`
   each statically imported `react-markdown` (only `FeedBody.tsx`, reached via
   `next/dynamic` in `FeedView.tsx`, was actually code-split). Reintroduced a
   `LazyMarkdown` (`React.lazy` + `Suspense`, falls back to raw text so
   reading-first layout never blanks) wrapping an isolated `MarkdownRenderer`
   module, and swapped all four call sites onto it.

   **Measured, isolated before/after** (fresh `origin/main` worktree vs. this
   branch, `.next/diagnostics/route-bundle-stats.json`,
   `firstLoadUncompressedJsBytes`):

   | route | before | after | delta |
   |---|---:|---:|---:|
   | `/app/interests` | 745,244 | 626,391 | **-118,853 (-16%)** |
   | `/app/interests/interest` | 674,848 | 561,040 | **-113,808 (-17%)** |
   | `/app/profile/interest` | 674,848 | 561,040 | **-113,808 (-17%)** |
   | all other routes | — | — | 0 / +8 (noise) |

   `/app/profile` itself is unaffected (ChatDock/ChatMarkdown weren't in its
   initial chunk group already) — the win is concentrated on the three routes
   that actually rendered markdown eagerly.

## Measured build / bundle surface (after fixes, full production build)

```text
CI=true pnpm build
Next.js 16.2.6 (Turbopack)
Routes exported: /, /_not-found, /app, /app/chat, /app/connect,
  /app/interests, /app/interests/interest, /app/liked, /app/profile,
  /app/profile/interest, /app/settings, /app/skills
```

- JS chunks gzip total: 336,422 bytes
- CSS chunks gzip total: 11,627 bytes
- Largest gzipped JS chunk: 72,620 bytes
- Largest public image: `public/og.png`, 123,044 bytes (OG-only, accepted)

## Review notes (no action needed)

- **Re-renders:** `FeedView` feed derivation and `useProfileWorkbench` card
  derivation are memoized; no un-memoized context providers found.
- **Other N+1/waterfalls:** none found beyond the fix above; the profile doc
  fetch paths don't fan out per-item.
- **Images:** no oversized assets beyond the already-accepted OG image; the
  three `next/image`-vs-`<img>` ESLint warnings (`FeedView.tsx`,
  `liked/page.tsx`, `ui/Chip.tsx`) are pre-existing and expected — `next/image`
  doesn't optimize cleanly under static export without a custom loader.
- **`packages/agent/src/server.ts`**: not a bundle/runtime concern (server-side
  agent package, not shipped to the browser); not touched here.

## Verification

- `rm -rf node_modules && CI=true pnpm install --frozen-lockfile` passed.
- `CI=true pnpm typecheck` passed (0 errors).
- `CI=true pnpm lint` passed (0 errors, 29 pre-existing warnings, unchanged).
- `CI=true pnpm test` passed (155 + 25 = 180/180).
- `CI=true pnpm build` passed; bundle measured from the freshly generated
  `out/` directory and `.next/diagnostics/route-bundle-stats.json`.
- Before/after route comparison used an isolated `git worktree` off
  `origin/main` — the live working tree was never left in a half-fixed state.
- No paid Apify scrape or external product flow was run.
