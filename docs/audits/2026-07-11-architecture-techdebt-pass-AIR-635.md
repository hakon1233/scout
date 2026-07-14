# AIR-635 — Architecture & Tech-Debt Review

_Recurring Quality-Loop pass (CTO). Date: 2026-07-11. Audited at `main` HEAD
`ace4b75`. Second architecture pass of the day — the first (AIR-619, commit
`bc2482e`, doc `2026-07-11-architecture-techdebt-pass-AIR-619.md`) landed hours
earlier, so this pass is scoped to **net-new** findings only._

## TL;DR

Still a **very well-tended** codebase (~16th architecture pass). The standing
structural debt is comprehensively tracked. This pass ran a fresh read-only audit
of `packages/agent/src` looking specifically for **crash-safety and error-handling
gaps** the prior structural passes hadn't surfaced, and found one that genuinely
moves the needle.

**Landed 1 small, clearly-safe, behavior-preserving fix directly** (this commit):
a missing `stdin` error handler that let a broken pipe crash the whole loopback
server. **Filed 1 net-new scoped issue** (readBody 413 teardown). **Enriched
AIR-374** with a second symptom instead of re-filing. Everything else maps to an
already-open issue or is a catalogued nit.

**Tree left green:** `tsc --noEmit` clean · `pnpm lint` 0 errors (29 pre-existing
`<img>`/unused-test-arg warnings) · agent suite 157/157 pass.

## Landed this pass

**Attach a `stdin` `error` listener at both `claude` spawn sites**
(`chat.ts` `chatComplete`, `research.ts` `runResearch`).

Both sites did `child.stdin!.write(prompt); child.stdin!.end();` with a listener
on `child` (`error`/`close`) but **none on `child.stdin`**. `child.on("error")`
only fires for spawn failures, not for stream errors on the pipe. If `claude`
closes its stdin read-end before we finish writing the multi-KB prompt — the most
likely trigger being an **immediate exit during a Claude outage or usage-limit
hit** — the pipe emits `EPIPE` as an `error` event on `child.stdin`. There is no
`process.on("uncaughtException")` anywhere in the package (verified), so that
unhandled stream error would **take down the entire loopback companion**,
abandoning every in-flight brief/chat. The failure mode is self-selecting for the
worst moment: it fires exactly when Claude is already unavailable.

Fix is additive and behavior-preserving: log the pipe error with the package's
`[chat]`/`[research]` prefix convention and swallow it. The existing
`error`/`close`/timeout handlers already settle the promise with the real cause
(the non-zero exit), so no control-flow changes. +14 lines, no test churn (the
`Writable` stub children in the suite simply never emit the error).

> Follow-up noted, not blocking: a regression test that emits `error` on a stub
> child's stdin and asserts the promise still settles (no process crash) would
> lock this in. Deferred because a reliable "process didn't crash" assertion under
> `node:test` is awkward/flaky-prone and the fix itself is a pure defensive
> listener. The clean home for such a test is the AIR-540 spawn-helper
> consolidation, where both copies collapse into one tested `spawnClaude`.

## Filed this pass (net-new, small, reversible)

| Issue         | Item                                                                                                                                                                                                                                                                                                                                                                                            | Sev |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **(filed)**   | `http-util.ts readBody` tears down the socket (`req.destroy()`) on the oversize-streaming path, then the handler answers `json(res, 413, …)` on the already-destroyed connection — so the client gets a **connection reset, not the 413** the abstraction promises. The memory protection still works; only the response is wrong. Narrow path: chunked / absent / under-declared `content-length` (accurate `content-length` fast-rejects earlier, socket intact). Distinct from AIR-177 (500 body leak) / AIR-178 (cap transcript). | LOW-MED |

## Enriched an existing issue (NOT re-filed)

- **AIR-374** (`POST /v0/weekly-brief` clobbers the single-flight brief slot):
  added a comment documenting a **second symptom of the same root cause** —
  `createAndPersistWeeklyBrief` (`weekly.ts:162`) also unshifts the
  `kind:"weekly"` brief into `state.briefs[]`, and `handleGetBriefs`
  (`routes/briefs.ts:32`) returns `state.briefs` verbatim as the paginated
  "previous daily editions" feed. So the weekly digest surfaces interleaved in
  the daily feed **and** evicts a real daily at the 30-cap. Whoever fixes AIR-374
  should give the weekly its own slot/history rather than only guarding the
  `last_brief` write. Not a separate ticket — same fix.

## Net-new findings catalogued (NOT filed / NOT fixed — low value or worse-when-touched)

- **`build-info.ts readBuildInfo` memoizes a transient first-read failure as
  `EMPTY` for the process lifetime** (`.catch(() => EMPTY)` is cached at
  `cache.set`). A momentary `EMFILE`/`EACCES` on the first `/healthz` or
  `/v0/version` hit would pin `git_sha`/provenance to `null` until restart.
  **Deliberately not fixed:** the obvious "drop the cache entry on catch" fix
  *regresses* the common case — `ENOENT` is the normal steady state when running
  from source via `tsx`, and dropping the cache would re-`stat` the missing file
  on every request. A correct fix must distinguish permanent (`ENOENT`/parse) from
  transient errors, adding branching to an otherwise-clean module for a QA-only,
  very-low-likelihood provenance blip. Not worth the complexity; logged here so a
  future pass doesn't "discover" it and apply the harmful naive fix.
- **`STORY_DATE_RE` exported from `search-skills.ts:37` is production-dead** (only
  `test/research.test.ts` imports it) while the same story-date regex is
  redefined in `weekly.ts:12` and web-side `src/lib/companion.ts:341`. Reads like
  a shared source of truth but isn't one. Folds into the AIR-272 / AIR-376
  wire-contract / brief-markdown-parser work; not worth a standalone ticket.

## Already tracked — confirmed still open, NOT re-filed

AIR-198 + AIR-540 (spawnClaude consolidation + chat timeout — the natural home for
the stdin-handler dedup and its regression test) · AIR-374 (weekly-brief slot,
enriched above) · AIR-375 (AppPage) · AIR-376 (brief-markdown parser) · AIR-377
(connect poll) · AIR-272 (date-token contract) · AIR-537 (state lost-update) ·
AIR-625 (decompose chat.ts) · AIR-626 (companion.ts silent swallow) · AIR-627
(ChatOp vocabulary drift). AIR-627 was reviewed for a direct fix and **left
filed**: the "rewrite persisted as update" resolution is a persistence-contract
decision (should a confirmed rewrite record `op:"rewrite"` or `op:"update"`?), not
a mechanical dedup — out of scope for an unsupervised clearly-safe edit.

## Non-issues checked (verified healthy this pass)

- `server.ts`, all `routes/*`, `state.ts`, `persistence.ts`, `docs.ts`,
  `static.ts`, `coverage.ts`, `runner.ts`, `scheduler.ts`, `service.ts`, `cli.ts`,
  `assembly-skills.ts` — error handling, single-flight guards, atomic writes, and
  path-traversal seams are solid; their known gaps are already tracked.
- The corrupt-`state.json` preservation path (`preserveCorruptState`), the
  StringDecoder chunk-boundary handling, and the abort/kill lifecycle in both
  spawn sites are all correct.
