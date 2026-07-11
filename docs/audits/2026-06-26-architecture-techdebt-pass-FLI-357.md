# Architecture & tech-debt review — 2026-06-26 (FLI-357)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt **only** —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to the sibling lanes and are deliberately left to them.

**Baseline & green gate:** `tsc --noEmit` clean; `pnpm test` **138/138** pass
(exit 0) before and after; `eslint` **0 errors**; Prettier clean on the touched
file. Smell sweep across `packages/agent/src` + `src/lib`: **no** `as any`
(the one grep hit is inside a comment, `chat.ts:230`), **no** empty `catch {}`,
**no** TODO/FIXME/HACK/XXX, **no** `@ts-ignore`/`@ts-expect-error`,
**no** bare `.catch(() => {})` swallows remaining.

## Overall read

Tenth+ CTO architecture pass. The codebase remains healthy — the
`@scout/agent` companion vs. Next.js web split is clean, modules are documented,
and the standing debt is specific and already tracked, not structural rot. The
last several passes (CAR-225 / CAR-239 / FLI-333) have been systematically
closing the **silent-error-swallow** class: converting bare swallows and
unguarded fire-and-forget rejections into prefixed `console.error`/`console.warn`
so ops/QA can diagnose failures from companion stderr.

This pass walked the **request-handling hot path of `server.ts`** (1100 LOC)
with that same observability lens, after re-verifying the two prior fire-and-
forget fixes landed: `runner.ts:280` (`[runner] runSynthesis … failed to
persist`) and `chat.ts:704` (`[chat] runChatTurn … failed to persist`) both now
log. Two previously-"noted-not-filed" items from AIR-188 were also re-checked
and confirmed **already resolved**: L3 (`weekly.ts LINK_RE` `/g` footgun — now a
stateless non-`/g` regex) and L1 (`scheduler.ts` vs `state.ts` time-validator
mismatch — `nextFireAt` now routes through `normalizeTimeOfDay`).

## Fixed directly this pass (small, clearly-safe, build/lint/test green)

1. **`server.ts:1082` — global request-error catch logged nothing to stderr.**
   The last-resort `} catch (err) { json(res, 500, { error: String(err) }) }`
   around the whole `/v0` route IIFE returned a 500 to the **client** but emitted
   **no** server-side signal. So an unhandled throw in *any* route (disk error,
   malformed state, an unexpected exception in a handler) produced a 500 that was
   completely invisible in the companion's own logs — "my brief/chat failed with
   a 500" was undiagnosable from stderr. This is the **same pattern, same
   reasoning** as the `runner.ts`/`chat.ts` fire-and-forget logs and the
   `state.ts:334` temp-cleanup warn (CAR-239) — the one remaining instance the
   prior passes hadn't reached, and the highest-blast-radius one because it
   covers every route at once.

   Fix: add a `console.error("[server] unhandled request error: <method>
   <path>:", err)` before the existing `json(res, 500, …)`, mirroring the
   `[runner]`/`[chat]`/`[state]` prefix convention and including the request
   method + pathname for correlation. **Additive observability only** — the 500
   response body is byte-identical, so no contract test changes. The `String(err)`
   **leak into the response body** is a separate, riskier concern (raw-error-
   string-to-client, the AIR-177 / CAR-180 class) and is deliberately left
   untouched here. Typecheck + lint (0 errors) + Prettier + 138 tests green.

## Candidates investigated and rejected / confirmed-resolved (with rationale)

- **`weekly.ts` `LINK_RE` `/g`-flag footgun (AIR-188 L3).** _Resolved._ Now a
  stateless regex without the `/g` flag (`weekly.ts:15-17`); the manual
  `lastIndex = 0` reset is gone. No action.
- **`scheduler.ts` `HH:MM`-strict vs `state.ts` `H:MM`-lenient time validator
  (AIR-188 L1).** _Resolved._ `nextFireAt` now normalizes via
  `normalizeTimeOfDay` (`scheduler.ts:30-37`), so a `"7:00"` no longer silently
  disables the schedule. No action.
- **`runner.ts` / `chat.ts` fire-and-forget rejections (CAR-146 class).**
  _Already fixed._ Both `.catch` handlers log with a prefixed message. No action.
- **`service.ts:203/211/244/248` `launchctl … .catch(() => undefined)`.**
  _Rejected — deliberate and correct._ These are best-effort teardown calls
  (`bootout`/`unload`) whose failure is expected when the agent isn't loaded;
  swallowing is the documented intent, and logging would be install/uninstall
  noise. Not a silent-failure of a *should-succeed* operation.
- **`build-info.ts:74` `.catch(() => EMPTY)`.** _Rejected — honest degradation,
  not a swallow._ A missing/corrupt `build-info.json` legitimately means "no
  provenance" and is served as `null` fields by contract (FLI-345). Logging a
  warn on every poll of a build that predates provenance would be steady noise.

## Verified already-tracked — deliberately NOT re-filed

- **FLI-232** — `server.ts` god-handler (~1100 LOC): extract `parseJsonBody()`,
  hoist `chatDeps`, single route table. (Backlog; the structural refactor this
  pass's one-line log does *not* substitute for.)
- **FLI-231** — harden `readChatTranscript`: don't wipe chat history on a
  non-ENOENT read/parse error. (Backlog.)
- **FLI-156** — CI "Typecheck" step is a no-op; wire `tsc -b`. (Backlog, high.)
- **FLI-325** — consolidate the story-date wire-token regex duplicated across
  agent↔web. (Backlog.)
- **CAR-132 C** — scattered magic fetch-timeout constants + repeated SSR
  `typeof window === "undefined"` guard. (Noted in
  `architecture-review-2026-06-25.md`; low-ROI, unchanged.)
- **AIR-177 / CAR-180** — raw `String(err)` leaked into the `/v0` 500 response
  body. The companion-stderr half is fixed above; the client-body leak stays
  with that issue (behavior-changing, needs care).

## Disposition

One clearly-safe, untracked observability fix landed directly — the global
`server.ts` request-error catch now logs to stderr, closing the last instance of
the silent-swallow class the recent passes have been systematically eliminating,
without touching the (tracked, riskier) response-body leak. Two prior
noted-not-filed items confirmed already resolved. Green gate holds (138/138,
typecheck clean, 0 lint errors, Prettier clean). No new issue filed — nothing
larger than already-tracked debt surfaced. Closing `done`.
