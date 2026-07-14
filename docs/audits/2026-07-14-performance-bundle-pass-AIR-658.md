# Performance & bundle-size pass - 2026-07-14 (AIR-658)

Recurring Quality-Loop performance pass.

## Scope

This pass follows AIR-730, the most recent performance/bundle audit on `main`.
`HEAD` matched `origin/main` at start (`484af51`), despite the stale local branch
name (`air-660-docs`). The pass therefore used the live product state, not a
stale fork.

Read the installed Next.js 16 docs before measuring:
`node_modules/next/dist/docs/01-app/02-guides/production-checklist.md` and
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/optimizePackageImports.md`.
Relevant guidance for this repo: keep client boundaries small, use `next build`
for production measurements, and use bundle analysis only when a large module or
dependency issue is suspected. This app has no broad package-import regression
surface this pass (`package.json` and `pnpm-lock.yaml` unchanged since AIR-730).

## Delta Since AIR-730

Six commits landed after AIR-730:

- `acd273a` `fix(likes): ignore malformed liked-story entries` - the only
  runtime client change; adds per-entry shape validation to the device-local
  likes store.
- `607810d` architecture audit doc plus a comment-only breadcrumb in
  `packages/agent/src/http-util.ts`.
- `89b1c85` security audit doc.
- `1ffdae9` README stack-line update to Next.js 16.
- `2e48514` `.env.example` local-Claude onboarding refresh.
- `484af51` Supabase README clarification for current vs legacy Exa edge
  functions.

No dependency or public-asset change landed. The only code path with measurable
bundle impact is the `src/lib/likes.ts` parser guard, which is imported by the
home app route and liked-feed route.

## Findings

### 1. No actionable bundle regression found

`acd273a` adds a small `isLikedStory()` guard and filters malformed likes during
localStorage parsing. That costs 415 uncompressed first-load JS bytes on the two
routes that import the likes store, and zero bytes elsewhere. This is an
acceptable robustness trade-off rather than a bundle-size regression worth
reverting or filing.

### 2. No new hot-path render or network-waterfall issue found

The new likes validation runs only when the cached raw localStorage string
changes. It is not per-render after the existing raw-string cache hits, and it
walks only the user's local liked-story map. The previously tracked hot-path
surfaces remain unchanged: companion polling, chat streaming, markdown lazy
loading, plain favicon `<img>` usage under static export, and the AIR-639
transcript-growth follow-up.

### 3. No new fix issue opened

The pass found no new reversible performance fix to delegate. Existing standing
items remain the right backlog:

- AIR-100 - font trim, design-gated.
- AIR-639 - chat transcript disk-growth cap / `since`-aware polling,
  contract-gated.
- AIR-551/AIR-552/AIR-553/AIR-554 - still appear to target a retired
  airbnb-assistant codebase rather than this `scout` repo; leave for PM
  backlog grooming rather than re-filing from this pass.

## Measured

Production build: `CI=true pnpm build`.
Source: `.next/diagnostics/route-bundle-stats.json`,
`firstLoadUncompressedJsBytes`.

| route | AIR-730 baseline | AIR-658 measurement | delta |
|---|---:|---:|---:|
| `/app/interests` | 653,506 | 653,506 | +0 |
| `/app` | 626,333 | 626,748 | +415 |
| `/app/settings` | 599,436 | 599,436 | +0 |
| `/app/liked` | 597,485 | 597,900 | +415 |
| `/app/skills` | 596,063 | 596,063 | +0 |
| `/app/connect` | 592,030 | 592,030 | +0 |
| `/app/interests/interest` | 586,730 | 586,730 | +0 |
| `/app/profile/interest` | 586,730 | 586,730 | +0 |
| `/app/profile` | 580,706 | 580,706 | +0 |
| `/app/chat` | 570,852 | 570,852 | +0 |
| `/` | 555,806 | 555,806 | +0 |

Static export browser spot-check (`npx serve out -l 4173`, Playwright Chromium,
fresh context per route, `waitUntil: "networkidle"`):

| route | status | encoded static JS | encoded CSS | total encoded bytes | load event |
|---|---:|---:|---:|---:|---:|
| `/` | 200 | 188,498 | 11,736 | 443,301 | 39 ms |
| `/app/` | 200 | 192,584 | 11,736 | 446,677 | 40 ms |
| `/app/liked/` | 200 | 192,584 | 11,736 | 444,003 | 39 ms |

These are local-machine numbers, useful as a smoke check rather than a field
performance claim. The important signal is that the built pages load cleanly
from the static export and the sampled routes do not trigger an obvious network
waterfall or unexpected image payload on first paint.

## Verification

- `CI=true pnpm build` passed (Next.js 16.2.6, Turbopack, static export).
- Route bundle diagnostics re-read from the fresh build.
- Static export served locally with `npx serve out -l 4173`; sampled `/`,
  `/app/`, and `/app/liked/` in Chromium successfully.
- `pnpm run test:web` passed 59/59, including the malformed liked-story
  regression test in `src/lib/likes.test.ts`.
- No full `pnpm test` run was needed for this report-only pass because
  `packages/agent/src/*` and `/v0/*` behavior were not changed by this work.
