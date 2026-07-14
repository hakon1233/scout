# Architecture & Tech-Debt Review — 2026-07-14 (AIR-682)

**Scope:** recurring quality pass (AIR-682). Broad structural re-assessment, not diff-scoped.
**Reviewer:** CTO
**Head at review:** `8c489af` (the AIR-670 architecture pass from one cycle earlier, ~1h prior)

> **Key context:** This is the *second* architecture pass of the day. The prior pass
> (AIR-670, `8c489af`, one Quality-Pass cycle earlier) did the exhaustive structural
> re-assessment, found the codebase in good shape, fixed one live trust-boundary gap
> (`pollBriefsRaw`), and concluded no new fix-issues were warranted. **Nothing has landed
> since** — that fix is HEAD. So there is again no new diff to review. Rather than
> re-run the identical scan and manufacture findings, this pass re-verified the standing
> findings and drilled into the one *class* the prior pass named — the F9 trust-boundary
> `as`-cast class — to check whether `pollBriefsRaw` was the only live instance.

---

## Standing findings — current state (do NOT re-file)

| Prior finding | Source | State |
|---|---|---|
| Duplicated `claude` spawn client across `chat.ts`/`research.ts` (drift-prone) | 2026-07-07 F2 / AIR-279 P1 | **Tracked** — open issue **AIR-661** (todo). |
| No structured logger; 44 raw `console.*` in agent | AIR-279 P2 | **Tracked** — open issue **AIR-662** (todo). |
| `pollBriefsRaw` returned `undefined` on a malformed body (F9 class) | AIR-670 | **Fixed** — `companion.ts:815` now `return json.briefs ?? []`. |
| `companion.ts` mixed responsibilities (~915 LOC) | AIR-279 P3 | Backlog visibility only; **not re-filed** (no active bug; low urgency). |
| Chat hard timeout / lint red / DNS-rebind / const-time token | 2026-07-07 F1/F23/§5 | **Fixed** (verified in AIR-670 pass; still green). |

---

## New finding fixed directly this pass

### Trust-boundary robustness — `generateWeeklyBrief` threw a raw TypeError on a malformed body

**File:** `src/lib/companion.ts:913` (before fix)

`generateWeeklyBrief` cast the `/v0/weekly-brief` response as `{ brief: AgentBrief }` and
passed `json.brief` straight into `adaptBrief` with no fallback. `adaptBrief`'s first line
dereferences its argument (`b.summary_md ?? ""`, then `b.id`, `b.generated_at`, …), so a
2xx response with a malformed/empty `{}` body (no `brief`) threw
`TypeError: Cannot read properties of undefined (reading 'summary_md')` — surfaced to the
user as a confusing generic error instead of the clean "couldn't generate weekly brief"
message the `!res.ok` path just above already produces.

This is the **direct sibling** of the line the prior pass (AIR-670) fixed at `:815`: the
same 2026-07-07 **F9** class (unvalidated `as` casts at the browser↔loopback trust
boundary). `pollBriefsRaw` was guarded; this path had the identical latent gap and was not
covered by any open issue.

**Why this one and not the other casts:** the remaining `.json() as {...}` casts
(`submitBrief` :263, `saveInterests` :301, `fetchSchedule` :740, `updateSchedule` :765,
`fetchCompanionConfig` :131) return an *object* whose fields are read as optionals
downstream — a missing field yields `undefined`, degrading gracefully, not a thrown
TypeError. Only `generateWeeklyBrief` shares the *immediate-dereference* pattern
(`adaptBrief(json.brief)`), so it is the only one in the throwing subclass. Guarding the
graceful-degradation casts would be scope-creep with no live bug behind it.

**Fix (applied):** widen the cast to `{ brief?: AgentBrief }` and throw the same clean
error as the `!res.ok` path when `brief` is missing. ~5 lines + comment; behavior-preserving
for well-formed responses. `pnpm typecheck` / `pnpm lint` / `pnpm test:web` (51 tests) all
green. No agent/`/v0` code touched, so the hermetic `@scout/agent` suite is unaffected.

**No regression test added:** matching the AIR-670 pass, which also relied on the
guard + comment. `companion.test.ts` only exercises pure functions
(`parseArticlesFromMarkdown`, `assessRunFailure`, `resolveLastSuccessBrief`); the
fetch-based functions have no mock harness, and introducing one here would be a larger,
less-reversible change than the one-line guard it would protect. Left as a follow-up
candidate if a `fetch`-mock harness is ever added for this module.

---

## Assessment

The architecture remains in good shape; two prior exhaustive audits have worked the
structural debt down to two tracked items (AIR-661 spawn dedup, AIR-662 logger) plus
backlog-visibility watch items. No new fix-issues are warranted from this pass — the one
live, untracked robustness gap found was small and clearly-safe enough to fix directly,
and it closes the last known live instance of the F9 class the prior passes documented.

**Watch items (no action needed now):** the two ~900–1050-LOC modules
(`companion.ts` ~915, `chat.ts` 1046) still concentrate churn; single-process global
mutable state (`chatInFlight`, unsynchronized `state.json` read-modify-write — 2026-07-07
F3) remains the failure mode to watch as the app grows. Both are already documented; neither
is urgent.
