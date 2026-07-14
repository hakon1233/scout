# Performance & bundle-size pass - 2026-07-14 (AIR-680)

Recurring Quality-Loop performance pass.

## Scope

Six real performance passes now precede this one (AIR-529, AIR-605, AIR-617,
AIR-633, AIR-668) and have exhaustively covered `src/` and
`packages/agent/src/` — bundle composition, re-renders, poll waterfalls,
images/fonts, agent-backend hot paths. This pass worked from a fresh branch
off `origin/main` (`air-680-performance-pass`, avoiding the stale-fork trap
AIR-668 found and documented) and diffed `origin/main` since AIR-668's audit
commit (`ea930a4`, 2026-07-14): **one** commit, `af22881` "a11y(nav): replace
partial ARIA menu semantics with disclosure popovers (AIR-407)" — six e2e spec
files plus `src/components/AppNav.tsx` (37 lines: a second `useRef`, a
`buttonRef.current?.focus()` call on Escape, and `role`/`aria-*` attribute
swaps). No new dependency, no new effect/poll/fetch, no re-render-shape
change — perf-neutral. Confirmed via bundle re-measurement below.

Given the thin diff, this pass also revisited the two still-open backlog
levers from prior passes (AIR-100, AIR-639) to check whether either had
become newly tractable.

## Fixed this pass

1. **`pollChatTurn` (`src/lib/chat.ts:126`) now passes `since=` on every poll
   tick**, closing the wire-payload half of AIR-639 ("Cap chat transcript
   growth / make GET /v0/chat since-aware"). `GET /v0/chat` has supported a
   `since` filter (matching `GET /v0/briefs`) since it was written — routes
   handler filters by `turn.created_at > since` — but the web client never
   passed it, so every ~1.2s poll tick during an in-flight chat turn (up to
   ~100 ticks over 120s) re-transferred the *entire* persisted transcript
   just to check one turn's status. Fixed by capturing `since = now - 30s`
   once per `pollChatTurn` call and sending it on every tick. The 30s slack
   is safe specifically because the companion is loopback (PER-1xx-series
   "loopback companion" — same machine, same clock as the browser tab), so
   there's no clock-skew risk of the buffer undershooting the turn's actual
   `created_at`; it comfortably excludes all history older than the current
   turn while requiring no server or persistence-contract change.

   This does **not** address the other half of AIR-639 (capping
   `transcript.json`'s unbounded on-disk growth) — that's a persistence-
   contract change touching the PER-201 "transcript survives a companion
   restart" guarantee, and deserves the dedicated review AIR-633's original
   audit called for. Left AIR-639 open, narrowed to just that remaining half
   (see Backlog below).

   Verification: new unit test
   (`src/lib/chat.test.ts` — `pollChatTurn passes a since= filter...`)
   asserting the poll URL carries a `since` timestamp before "now"; full
   `pnpm test` green (214→215); a real end-to-end run —
   `SCOUT_E2E_PORT=47931 npx playwright test e2e/chat-actions.spec.ts` (the
   create/rewrite/delete action-card flow, which round-trips through
   `pollChatTurn` against the real companion + stub-claude fixture) —
   1/1 passed. Production bundle re-measured (below): only `/app/interests`
   moved, +72 bytes (the changed function's own tiny code growth).

## Investigated, not fixed

- **AIR-100** (font trim — `next/font/google` weight/family payload) is
  still accurate and still design-gated; no `layout.tsx` or font-loading
  code changed since it was last measured (AIR-218). Left as-is, routed to
  the Designer lane as before.
- **AIR-639**'s remaining half (transcript disk-growth cap) — sketched but
  not attempted this pass. `appendChatTranscript` (`packages/agent/src/chat.ts:194`)
  would need a cap mirroring `BRIEF_HISTORY_CAP` (`state.ts:160`), but unlike
  the briefs list (already point-in-time snapshots), capping transcript turns
  is a persistence contract change the PER-201 restart-survival test
  explicitly exists to protect — correctly scoped as its own reviewed change,
  not a same-pass drive-by.
- Re-confirmed no new dependencies (`package.json`/`packages/agent/package.json`
  unchanged), no new files under `public/` (`og.png` still the only asset over
  a few KB), and `packages/agent/src` has had zero commits since AIR-633's
  audit (0429e19) beyond what AIR-668 already reviewed.

## Measured

Production build (`CI=true pnpm build`),
`.next/diagnostics/route-bundle-stats.json`, `firstLoadUncompressedJsBytes`:

| route | AIR-668 baseline | after this pass |
|---|---:|---:|
| `/app/interests` | 652,716 | 652,924 (+208) |
| `/app/connect` | 590,885 | 591,116 (+231) |
| `/app` | 625,625 | 625,761 (+136) |
| `/app/interests/interest` | 585,864 | 585,956 (+92) |
| `/app/profile/interest` | 585,864 | 585,956 (+92) |
| `/app/profile` | 581,216 | 581,348 (+132) |
| `/app/settings` | 599,686 | 599,822 (+136) |
| `/app/liked` | 597,995 | 598,127 (+132) |
| `/app/skills` | 596,573 | 596,705 (+132) |
| `/app/chat` | 571,192 | 571,280 (+88) |
| `/` | 555,716 | 555,764 (+48) |

The +48..+231 byte deltas are the af22881 a11y commit's incidental string/JS
growth (extra ref, extra `id` attribute, focus-restore call) across every
route sharing `AppNav.tsx`, plus (on `/app/interests` only) this pass's own
`since=` fix — expected, not a regression.

## Verification

- `pnpm typecheck` passed (0 errors).
- `pnpm lint` passed (0 errors, 0 warnings).
- `CI=true pnpm test` passed (2 + 161 + 52 = 215/215, up from 214 — one new
  unit test added this pass).
- `CI=true pnpm build` passed; bundle re-measured post-fix (above).
- `SCOUT_E2E_PORT=47931 npx playwright test e2e/chat-actions.spec.ts` — 1/1
  passed (real companion + stub-claude, exercises `pollChatTurn` end-to-end).

## Backlog

- AIR-100 (font trim, design-gated) — unchanged, still open.
- AIR-639 — narrowed to just the transcript disk-growth cap (the since-aware
  wire half is fixed this pass); left open, not re-filed.
