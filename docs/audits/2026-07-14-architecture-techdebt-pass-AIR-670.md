# Architecture & Tech-Debt Review — 2026-07-14

**Scope:** recurring quality pass (AIR-670). Broad structural re-assessment, not diff-scoped.
**Reviewer:** CTO
**Head at review:** `9712e19` (the AIR-279 audit doc itself)

> **Key context:** No code has landed since the last architecture pass (AIR-279,
> 2026-07-12) — `9712e19` is HEAD and it is that pass's own doc. So there is no new diff
> to review; this pass instead re-verifies the standing findings and takes a fresh
> structural look for *accumulating* debt.
>
> A full parallel Quality-Pass batch (AIR-664–671: security, design, bug-hunt, QA-live,
> perf, product-gap, docs) was running concurrently against this same repo. To avoid
> collisions this pass stayed strictly in the architecture lane and made a single
> isolated, clearly-safe change.

---

## Standing findings — current state (do NOT re-file)

| Prior finding | Source | State |
|---|---|---|
| Chat has no hard timeout → hung `claude` child wedges all chat (`chatInFlight` never clears) | 2026-07-07 F1 | **Fixed** — `chat.ts:434,475–492` now has the same SIGTERM→SIGKILL bounded timeout as `research.ts`, with a comment describing the exact wedge scenario. |
| `main` red / deploys blocked on `no-explicit-any` | 2026-07-07 F23 | **Fixed** — `pnpm lint` and `pnpm typecheck` both green at HEAD. |
| Duplicated `claude` spawn client across `chat.ts`/`research.ts` (drift-prone) | 2026-07-07 F2 / AIR-279 P1 | **Tracked** — open issue **AIR-661** (todo). |
| No structured logger; 44 raw `console.*` in agent | AIR-279 P2 | **Tracked** — open issue **AIR-662** (todo). |
| DNS-rebinding Host check / constant-time token compare / `server.ts` monolith | 2026-07-07 §5 | **Fixed** (pre-audit). |
| `companion.ts` mixed responsibilities (910 LOC) | AIR-279 P3 | Backlog visibility only; **not re-filed** (no active bug; low urgency; unchanged). |

Findings F3–F22 from the 2026-07-07 full audit were each filed as backlog issues at that
time (per that doc's §6). They are not re-filed here.

---

## New finding fixed directly this pass

### Trust-boundary robustness — `pollBriefsRaw` returned `undefined` on a malformed body

**File:** `src/lib/companion.ts:816` (before fix)

`pollBriefsRaw` cast the loopback response as `{ briefs: AgentBrief[] }` and returned
`json.briefs` with no fallback. A malformed/empty `{}` body (missing `briefs`) therefore
handed callers `undefined`. Every caller (`pollBriefs` → `.filter().map()`,
`newestReadyBrief` → `.filter().reduce()`, and the poll loop at `:881`) immediately
iterates the result, so a missing field throws a `TypeError` surfaced as a confusing
generic error instead of a clean "no briefs". The sibling `fetchBriefsPage` already
guarded this with `?? []`; this path had drifted.

This was a live, un-tracked instance of the 2026-07-07 **F9** class (unvalidated `as`
casts at the browser↔loopback trust boundary). It was not covered by any open issue.

**Fix (applied):** return `json.briefs ?? []`, matching `fetchBriefsPage`, with a comment
marking the trust boundary. One line + comment; behavior-preserving for well-formed
responses; `pnpm typecheck` / `pnpm lint` / `pnpm test:web` (51 tests) all green.

---

## Assessment

The architecture is in good shape and the two prior audits have been substantially worked
down. The highest-value structural items that remain are already tracked (AIR-661 spawn
dedup, AIR-662 logger). No new fix-issues are warranted from this pass — the one live,
untracked robustness gap found was small and clearly-safe enough to fix directly. Deferring
manufacturing issues is the correct call given the exhaustive prior coverage and the
concurrent parallel batch already sweeping security/perf/bug/design.

**Watch items (no action needed now):** the two remaining ~900-LOC modules
(`companion.ts` 910, `chat.ts` 1046) still concentrate churn; single-process global
mutable state (`chatInFlight`, unsynchronized `state.json` R-M-W — 2026-07-07 F3) remains
the failure mode to watch as the app grows. Neither is urgent; both are already documented.
