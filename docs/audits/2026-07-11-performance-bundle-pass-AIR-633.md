# Performance & bundle-size pass - 2026-07-11 (AIR-633)

Recurring Quality-Loop performance pass. Started from `origin/main` at
`5843b3f` (AIR-617, same day). New branch (`air-633-performance-pass`);
`air-617-performance-pass` was already merged and stale, same practice
AIR-529/605/617 established. Rebased onto `origin/main` again before pushing
(3 more commits landed mid-pass: AIR-624's pnpm/CI pin + a dark-token e2e
update, and an eslint-config fix for intentional underscore args) — no
conflicts, none touched `packages/agent/` or anything this pass's fixes
touch. Numbers below are measured post-rebase, on the code actually pushed.

## Scope decision

Three consecutive passes (AIR-529, AIR-605, AIR-617) already audited `src/`
(the Next.js web app) in depth — bundle composition, re-renders, poll
waterfalls, images, fonts. A fresh manual sweep this pass (re-reading
`FeedView.tsx`, `AppNav.tsx`, `page.tsx`'s `filteredBrief`/poll effects,
`useProfileWorkbench.ts`, image `loading="lazy"` usage, `next.config.ts`,
`layout.tsx`'s font config) found nothing new: every previously-flagged narrow
item (declined in AIR-605/617) is unchanged and still correctly narrow, and no
new regressions have landed since AIR-617 (confirmed — zero intervening
commits touched `src/`). Bundle sizes are byte-for-byte identical to AIR-617's
measurements (see below).

**This pass instead focused on `packages/agent/src/`** (the local companion
backend serving `/v0`), which none of the prior three passes had audited —
they only ever looked at the browser-facing web app. A dedicated sub-agent
read the whole package (`chat.ts`, `runner.ts`, `state.ts`, `server.ts`,
`scheduler.ts`, `research.ts`, `http-util.ts`, `static.ts`, `routes/*.ts`)
against the same "hot-path/N+1/heavy-sync-work" categories used by the `src/`
passes. Manual follow-up confirmed each finding against the actual request/
poll frequencies before fixing.

## Fixed this pass

1. **`GET /v0/chat` re-read + re-parsed the entire, ever-growing chat
   transcript from disk on every poll tick.** `packages/agent/src/chat.ts`,
   `packages/agent/src/routes/chat.ts`. The web client's `pollChatTurn`
   (`src/lib/chat.ts:126`) polls `GET /v0/chat` every 1200ms for up to 120s per
   chat turn, with **no `since` filter** — every tick fetches the full turn
   history. Server-side, `handleGetChat` called `readChatTranscript`, which
   does a full `fs.readFile` + `JSON.parse` + per-entry shape validation of
   the whole file, every single call. Unlike `state.briefs` (capped at
   `BRIEF_HISTORY_CAP = 30`), the transcript has no cap, and each turn can
   carry a full markdown doc in `ChatChange.doc` — so this compounds over a
   companion's lifetime. Added `readChatTranscriptCached` (module-level cache
   keyed by transcript file path, populated lazily, updated **only after a
   write commits** — never optimistically, so a failed write can't leave the
   cache ahead of disk) and routed the two hot callers (`handleGetChat`,
   `runChatTurn`'s model-context read) through it. `appendChatTranscript`
   (the sole writer) now reads from the cache instead of disk too, saving a
   redundant read on every turn completion. `readChatTranscript` itself is
   untouched and still a true disk read — it's the corrupt-transcript-recovery
   path and is exercised directly by the CAR-195/CAR-146 tests, which must see
   real disk state. Verified safe: chat.ts is the only writer of a live
   transcript file (grepped every call site), so a cache that only chat.ts's
   own writes can invalidate can't drift from what's actually on disk in
   production. The PER-201 "restart" test still passes because the cache is
   keyed by file path and a real restart is a fresh process (empty cache,
   first read repopulates from disk) — see Verification.

2. **CORS/host-allowlist re-parsed `SCOUT_ALLOWED_ORIGINS` on every single
   HTTP request.** `packages/agent/src/http-util.ts`. `isHostAllowed` runs
   unconditionally in `server.ts`'s request pipeline before any routing —
   every poll, every static asset, every OPTIONS preflight. Its
   `extraAllowedOriginHostnames()` helper re-split + re-`new URL()`-parsed the
   env var on every call, while its sibling `extraAllowedOrigins()` (same env
   var, feeding `CORS_ALLOWED_ORIGINS`) was already computed once at module
   load. Cheap when the var is unset (the common case — early-return `[]`),
   but real waste in the hottest path in the server once an operator sets it.
   **Not a plain one-shot memo**: `test/version.test.ts`'s PER-276 test sets
   `process.env.SCOUT_ALLOWED_ORIGINS` *after* the server has already started
   and expects the very next request to honor it, no restart. Fixed with a
   cache keyed by the raw env-var *value* (recomputed only when the string
   actually changes) rather than computed once at import — same idiom as
   AIR-617's `pingCachedBase`, applied to a value-dependent cache instead of
   an in-flight one.

3. **Static file serving re-`stat`'d the immutable webroot directory on every
   request, sometimes twice.** `packages/agent/src/static.ts`. `hasWebroot()`
   runs an `fs.stat` and is called from both `trailingSlashRedirect` and
   `resolveStatic` — a single unmatched extensionless request can trigger it
   twice. Whether the bundled `webroot/` directory exists is fixed for the
   whole process lifetime (bundled in prod, absent in dev — the file's own
   header comment says so), exactly the kind of build-time-immutable fact
   `build-info.ts`'s `readBuildInfo` already memoizes. Added a `Map`-based
   cache keyed by the `root` argument (tests pass distinct tmp roots per test,
   so this can't leak state across them — verified only one test file
   exercises these functions and each uses its own `mkdtemp`).

## Investigated, not fixed — filed as follow-up (see child issue)

- **The chat transcript itself still grows without bound**, and
  `GET /v0/chat` still returns the *entire* history on every poll (no
  `since`-based filtering on the wire, unlike `GET /v0/briefs`) — the cache
  above removes the redundant disk I/O but not the growing JSON payload size
  over a long-lived companion, nor the unbounded disk file. A cap (mirroring
  `BRIEF_HISTORY_CAP`) or a `since`-aware client poll would fix the root
  cause, but both change the wire/persistence contract in ways that deserve
  their own review and test coverage rather than being bundled into this
  pass's I/O-caching fix. Filed as a follow-up issue (see below).
- **Static file *content* caching** (not just the `hasWebroot` existence
  check) — `resolveStatic` still does a fresh `fs.readFile` per asset request
  even though the bundle is immutable for the process lifetime. Lower value
  than the existence-check fix (content reads are already OS-page-cache-warm
  after the first hit, and this is a single-user loopback server, not a
  multi-tenant CDN); noted for whoever next touches `static.ts`, not filed as
  its own issue — too marginal to clear the "genuinely moves the needle" bar
  on its own.
- The sequential (not `Promise.all`'d) per-interest research loop in
  `runner.ts` (`for (const interest of plan.researchInterests)`) looked like
  an N+1/waterfall candidate at first read, but its own comment explains it's
  deliberate: the synth child runs at niceness 10 specifically so it can't
  starve the loopback server (PER-101), and firing several at once would
  defeat that. Correctly left alone.
- Re-confirmed all of AIR-605/617's declined `src/` items (`filteredBrief`
  unmemoized in `page.tsx`, `AppNav`'s scroll listener, the narrow
  first-mount `fetchLatestBrief`/`fetchRunFailure` overlap, the CAR-272
  Turbopack chunk-duplication) — unchanged, still correctly narrow/declined,
  not re-litigated.
- Images/fonts: no oversized assets beyond the already-accepted
  `public/og.png` (123KB, OG-only); all feed/favicon `<img>` tags already
  `loading="lazy"`; `next/font` usage already scoped to specific weights.
  Nothing new since AIR-605/617.
- `packages/agent`'s own dependency list is empty (`dependencies: {}` — pure
  Node built-ins), so there's no bundled-library bloat to audit there.

## Follow-up issue

Filed **AIR-639** — cap the persisted chat transcript (mirroring
`BRIEF_HISTORY_CAP`) and/or have the client's `pollChatTurn` pass `since` so
`GET /v0/chat` stops shipping full history on every 1.2s tick. Scoped
separately because it changes the `/v0/chat` wire contract and the
restart-persistence guarantee PER-201 tests, which deserves its own
review/test pass rather than riding along with this pass's caching fix.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json` — byte-identical to AIR-617's
numbers (expected: every fix this pass is `packages/agent` backend I/O, none
touch the client bundle):

| route | AIR-617 | this pass |
|---|---:|---:|
| `/app/interests` | 650,856 | 650,856 |
| `/app` | 625,079 | 625,079 |
| `/app/settings` | 599,180 | 599,180 |
| `/app/skills` | 596,382 | 596,382 |
| `/app/liked` | 597,764 | 597,764 |
| `/app/connect` | 590,379 | 590,379 |
| `/app/interests/interest` | 585,244 | 585,244 |
| `/app/profile/interest` | 585,244 | 585,244 |
| `/app/profile` | 581,025 | 581,025 |
| `/app/chat` | 571,001 | 571,001 |
| `/` | 555,360 | 555,360 |

## Verification

- `CI=true pnpm typecheck` passed (0 errors).
- `CI=true pnpm lint` passed (0 errors, 4 pre-existing warnings — down from
  AIR-617's 29 because the eslint-config fix that landed mid-pass, above,
  silenced the intentional-underscore-arg warnings; unrelated to this pass's
  own changes).
- `CI=true pnpm test` passed (1 + 157 + 30 = 188/188, unchanged from AIR-617's
  baseline).
- Targeted re-run of the three touched agent test files directly
  (`npx tsx --test test/chat.test.ts test/static.test.ts test/version.test.ts`,
  30/30) to double-check the specific tests each fix's design reasoning
  depends on: PER-201 (transcript survives a real restart), CAR-195/CAR-146
  (corrupt-transcript recovery still does a true disk read), and PER-276
  (runtime `SCOUT_ALLOWED_ORIGINS` change takes effect without a restart) —
  all passed.
- `CI=true pnpm build` passed; bundle re-measured, matches AIR-617 exactly
  (see above). `pnpm run build:agent` (the package's own `tsc`) also passed.
- `SCOUT_E2E_PORT=47919 npx playwright test responsive-chat.spec.ts
  reduced-motion-chat.spec.ts markdown-chat.spec.ts zero-prompt.spec.ts`
  (isolated port — default 47821 held by an unrelated long-running process),
  10/10 passed — exercises the real chat send/poll path end-to-end against
  the actual packed companion tarball built from this pass's changes.
- No paid Apify scrape or external product flow was run.

## Follow-ups

- AIR-639 (filed): cap the chat transcript / make `GET /v0/chat` `since`-aware.
- Static file *content* caching in `static.ts` (noted above, not filed —
  too marginal on its own).
