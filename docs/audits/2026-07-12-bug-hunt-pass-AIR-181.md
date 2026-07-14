# Bug hunt & fix pass — 2026-07-12 (AIR-181)

Recurring Quality-Loop pass (Engineer slice of AIR-181). Scope: real, provable
correctness bugs found by code reading + hermetic unit tests, fixed small +
reversible, red-before-green. Sibling passes this cycle already covered the
likes store (AIR-646), theme colorScheme (AIR-156), the chat confirm-Undo
(AIR-611), and the e2e stub (AIR-642), so this pass targeted the profile chat
hook's retry path and the per-topic coverage classifier.

Hard guardrail honored: no paid Apify scrape; all tests mock the `claude`
shell-out and run offline.

## Fixed

1. **`retry()` double-kicked the turn from inside a `setMessages` updater**
   (medium) — FIXED. `useProfileWorkbench.ts`: `retry` computed the target and
   then called `queueMicrotask(() => dispatch(wire))` **inside** the
   `setMessages` updater. React updaters must be pure and may run more than once
   — StrictMode double-invokes them in dev — so a single Retry click scheduled
   `dispatch` twice. The second kick hit the companion's single-flight chat slot
   and 409'd, surfacing a spurious "Scout is still working on your last message"
   error right after the user clicked Retry once. Fix: extracted the pure target
   computation into `resolveRetryTarget(messages, scoutId, focusTopic)` in
   `useProfileWorkbench.helpers.ts`, mirrored `messages` into a `messagesRef`
   (same pattern as the existing `docBodiesRef`), and rewrote `retry` to compute
   the target from the ref and call `setMessages` + `dispatch` exactly once as
   ordinary event-handler side effects — never from inside an updater. Added
   `resolveRetryTarget` unit tests (target selection, focus-scope prefixing, and
   the three null-guard cases). RED→GREEN.

2. **`computeCoverage` counted an INLINE markdown image as a source citation**
   (low) — FIXED. `packages/agent/src/coverage.ts`: the `hasCitation` check
   skipped only lines that *started* with `!`, to keep a standalone source image
   (`![alt](url)`) from reading as a citation. An image embedded mid-line inside
   prose (`… ![chart](https://…) …`) left a bare `](https://…)` that still
   matched, so a section with an inline image but no real `[label](url)` source
   was classified `"covered"` instead of `"empty"` — suppressing the focused
   retry (PER-154) that would recover a real citation and showing the user a
   "covered" topic with no clickable source. Fix: strip markdown image syntax
   from each line (`.replace(/!\[[^\]]*\]\([^)]*\)/g, "")`) before testing for a
   link, so an image counts for nothing whether standalone or inline. Added an
   inline-image regression test alongside the existing standalone-image one.
   RED→GREEN. Reachable only via malformed model output (SEARCH_SKILLS normally
   puts images on their own line), hence low severity — but it's a one-line
   hardening that makes the guard match its documented intent.

## Reported (filed as fix-issues — real, but out of scope for a small drive-by)

3. **Confirm-gated delete/rewrite: Stop is a dead control and can clobber a
   later turn's `sending`** (HIGH). `useProfileWorkbench.ts` `confirmDelete`
   (225–252) / `confirmRewrite` (268–303). While a confirm fetch is in flight
   `sending===true`, so the composer shows **Stop**. Pressing Stop reverts the
   composer to "Send" but the destructive op still completes (the confirm
   fetches take no external abort signal — `confirmDeleteInterest` /
   `confirmRewriteInterest` use their own `AbortSignal.timeout`), so the
   interest is still deleted / the doc still rewritten. Worse, both handlers
   clear `sending` **unconditionally** in `finally` — unlike `dispatch`, which
   guards `if (!controller.signal.aborted)` after the AIR-107 fix. So a
   Stop-then-resend during a confirm lets the confirm's late `finally` clobber
   the *new* turn's in-flight `sending`, flipping Stop→Send mid-turn and 409-ing
   a resend — the exact AIR-107 symptom in a path AIR-107 didn't touch. Fix
   needs a lib signature change (thread an external signal into the two confirm
   fetches) + the same `finally` guard `dispatch` has, plus a hook-render test —
   larger than this pass's "small + reversible" bar. Filed as a fix-issue.

4. **`GET /v0/interests` 500s the whole list if one interest doc is unreadable**
   (LOW). `packages/agent/src/routes/interests.ts` (~103–117): the per-interest
   `readInterestDoc` / `interestDocMeta` calls run inside a `Promise.all`; both
   throw on any non-ENOENT fs error (EISDIR, EACCES). One bad `<id>.md` rejects
   the whole `Promise.all` → the router returns a 500 and the founder sees *none*
   of their interests, even though the response shape already supports
   per-entry `hasDoc:false / doc:null` degradation. Fix: isolate each doc read
   (`.catch(() => …)` or `Promise.allSettled`) so one unreadable doc degrades
   only its own entry. Contrived fs trigger, hence low. Filed as a fix-issue.

## Reviewed, not filed (trivial / not reachable via the real client)

- **`GET /v0/briefs?limit=` (empty string) returns 1 brief, not the default 3.**
  `routes/briefs.ts` clamp guards `raw === null` but `Number("") === 0` slips
  through → `Math.max(1, 0) = 1`. Deterministic but no real client sends an
  empty `limit`; the feed always sends `?limit=3&offset=N`. One-line fix
  available (`raw.trim() === "" → def`) if a hardening pass wants it.
- **`POST /v0/chat/stop` with a non-string `turn_id` (e.g. `999`) aborts the
  in-flight turn.** `routes/chat.ts` narrows a present-but-non-string id to
  `undefined`, conflating "no id" with "wrong id" and defeating the match guard.
  Only reachable by a misbehaving/hostile client (real ids are UUID strings).
- **Focused retry merges daily sections into a weekly brief** if
  `state.last_brief.kind === "weekly"`. `runner.ts:219` uses `last_brief` as the
  retry base without a `kind` guard. The scheduler auto-retry and the FE can't
  reach it (a weekly has no coverage/retry affordance) — only a hand-crafted API
  call triggers it.
- **`isHostAllowed` honors runtime `SCOUT_ALLOWED_ORIGINS` but the `/v0`
  origin-deny gate reads the import-frozen `CORS_ALLOWED_ORIGINS`.** A
  runtime-added origin passes the Host gate yet is 403'd by origin-deny. In
  production the env is set before startup so both agree; non-observable unless
  live origin reconfiguration is supported.
- **Bootstrap transcript load replaces in-flight `messages`** for a returning
  user (`useProfileWorkbench.ts:122–129`) — a message sent during the async
  hydration gap could be wiped. Narrow timing window; low confidence.

## Verification

- Agent suite (`tsx --test packages/agent/test/*.test.ts`): 160/160.
- Web suite (`test:web` file list): 49/49, incl. the new `resolveRetryTarget`
  (3 tests) and inline-image coverage regression — both RED before the fix.
- Root `test/*.test.mjs`: 1/1.
- `tsc --noEmit` (root) clean; agent `tsc -p tsconfig.json --noEmit` clean.
- `eslint` on the changed web files: 0 errors.

## Notes for the next pass

- pnpm 11.9 still silently rewrites `pnpm-lock.yaml` (drops the postcss
  override) on any bare `pnpm <cmd>`; used direct `node_modules/.bin/*` binaries
  throughout.
- Shared-workspace collision is live: the branch HEAD advanced from `5573437`
  to `cd9597a` (a sibling's AIR-509 feed fix) mid-run. `origin/main` tracks this
  branch's HEAD, so staged only this pass's files (never `git add -A`) and
  pushed `HEAD:main`.
