# Architecture & tech-debt review — 2026-06-26 (FLI-333)

Recurring Quality-Loop pass (CTO). Scope is architecture / tech-debt **only** —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability. Bugs, perf, security, design, docs and product
gaps belong to the sibling lanes in this same Quality Pass (FLI-326 parent) and
are deliberately left to them.

**Baseline & green gate:** typecheck clean, `pnpm test` **130/130** pass
(exit 0), `eslint` **0 errors** (27 warnings, all the tracked
`@next/next/no-img-element` LCP perf-lane nits — not architecture), Prettier
clean on all touched files. Debt-smell sweep clean: **no** `as any` (the two
grep hits are inside comments — `useProfileWorkbench.ts:379`, `chat.ts:246`),
the only empty `catch {}` is the intentional theme-write swallow
(`ThemeToggle.tsx:43/194`), **no** TODO/FIXME/HACK/XXX,
**no** `@ts-ignore`/`@ts-expect-error`.

## Overall read

Ninth CTO architecture pass. The codebase remains healthy; the debt is
**specific and already tracked**, not structural rot. Prior passes walked the
**agent backend** (`packages/agent/src/*`), the **frontend lib layer**
(`companion.ts`, `chat.ts`, `useProfileWorkbench.ts`) and the **React component
layer** (`AppNav`, `FeedView`, `ScheduleSettings`, `BriefHistory`,
`ErrorBanner`). This pass broadened to the **App Router page components**
(`src/app/**/page.tsx`) and the **remaining `src/lib` persistence modules**
(`storage.ts`, `likes.ts`, `interest-docs.ts`, `run-history.ts`, `skills.ts`,
`chat-diff.ts`) — none reviewed at the structural level before.

A fan-out review surfaced one **defect class** worth fixing and one trivial
**dedup**; both were clearly-safe, self-contained, and reversible, so both were
**fixed directly**. Everything else was investigated and rejected or confirmed
already-tracked (rationale below). No new issue filed — nothing larger than a
one-liner that isn't already on the board.

## Fixed directly this pass (small, clearly-safe, build/lint/test green)

1. **Unguarded `localStorage.setItem` — inconsistent with its documented
   sibling, crashes the caller before its in-memory `setState`.**
   (`src/lib/storage.ts`, `src/lib/companion.ts`)

   `src/lib/likes.ts` `write()` deliberately wraps `setItem` in a try/catch with
   an explicit comment: quota-exceeded and private-mode browsers throw, so it
   swallows the failure and keeps the in-memory cache live for the session. Its
   direct siblings did **not** follow the pattern: `storage.ts` `saveSettings` /
   `saveLastBrief` / `savePrevBrief` and `companion.ts` `saveCompanionToken` all
   called `setItem` **unguarded**.

   Why it matters (not merely cosmetic): every caller does
   `saveX(...); setState(...)` back-to-back (e.g. `app/page.tsx:145` adoption,
   `:174/:216` reconcile, `:302/:363` generate; `connect/page.tsx:151` pairing).
   An unguarded throw propagates out of the writer and **aborts the handler
   before the `setState` runs** — so in a quota/private-mode browser the UI would
   neither persist *nor* update in memory, which is strictly worse than the
   `likes.ts` degradation. `saveCompanionToken` throwing would abort the pairing
   handler mid-flow.

   Fix: add a private `safeSet(key, value)` helper in `storage.ts` (mirroring
   `likes.ts` `write()`) and route the three writers through it; apply the same
   guard inline in `companion.ts` `saveCompanionToken`. Behavior-identical on the
   success path; on failure it degrades to best-effort persistence (session
   state still correct, just not durable across reload) exactly like `likes.ts`.
   Typecheck + lint (0 errors) + prettier + 130 tests green.

2. **The "companion isn't paired" guidance string was copy-pasted verbatim
   across the two run paths.** (`src/app/app/page.tsx`)

   `generate()` (was ~line 254) and `runWeekly()` (was ~line 342) each inlined
   the byte-identical `setError(classifyError(new Error("Scout companion isn't
   paired yet. …")))` guard. The user-facing string is load-bearing onboarding
   copy and the two call sites have been re-touched by independent lanes before,
   so drift is a real risk.

   Fix: hoist the message to a module-level `COMPANION_NOT_PAIRED_MSG` const and
   reference it from both guards. Pure dedup of the string; the early-`return`
   control flow at each site is left in place (it can't be abstracted into a
   helper without obscuring the early return). Behavior-identical.

## Candidate seams investigated and rejected (with rationale)

- **`interest-docs.ts:72` — `res.json()` not individually try/caught.**
  _Rejected — already safe._ The whole fetch+parse sits inside a `try` that
  returns the empty/null fallback; a malformed body is already handled. Wrapping
  it tighter would add noise for no behavior change.
- **`interests/page.tsx:45/62` — `new URL(window.location.href)` history-update
  blocks duplicated.** _Rejected — low value, divergent intent._ The two blocks
  differ (`pushState` open vs `replaceState`/close) and the `catch` can't fire in
  practice (`location.href` is always a valid URL); extracting a helper would
  hide that the silent-fail is deliberate, not save real lines.
- **`connect/page.tsx` (ref+guard) vs `app/page.tsx` (local var) `setInterval`
  cleanup.** _Rejected — both correct, pure style._ Neither leaks; unifying is
  churn with no safety delta.
- **URL-param read styles (`interests/page.tsx:33` vs
  `profile/interest/page.tsx:103`).** _Rejected — style only, no shared seam yet._

## Verified already-tracked — deliberately NOT re-filed

- **FLI-325** (backlog) — consolidate the story-date wire-token regex (4×
  duplicated across agent↔web; canonical export unused). Filed by FLI-319.
- **FLI-231** (backlog) — harden `readChatTranscript`: don't wipe chat history on
  a non-ENOENT read/parse error.
- **FLI-232** (backlog) — `server.ts` god-handler (~1099 LOC): extract
  `parseJsonBody()`, hoist `chatDeps`, single route table.
- **FLI-156** (backlog, high) — CI "Typecheck" step is a no-op; wire `tsc -b`.
- **CAR-132 C** — the scattered magic fetch-timeout constants
  (1500/2000/2500/5000/8000/10000 ms across `companion.ts` + `interest-docs.ts`)
  and the repeated SSR `typeof window === "undefined"` guard. Still noted in
  `architecture-review-2026-06-25.md`; unchanged this pass. The Explore sweep
  re-surfaced the timeout constants — confirmed it is the same already-noted item,
  **not** re-filed.

## Disposition

Extended the documented review frontier to the **App Router page components** and
the remaining **`src/lib` persistence modules**; **fixed two** clearly-safe items
directly — the unguarded-`setItem` defect class (4 call sites across `storage.ts`
+ `companion.ts`, now consistent with `likes.ts`) and the duplicated
companion-not-paired message — and **verified-rejected** the rest with rationale
so the next pass does not re-derive them. Green gate holds (130/130, typecheck
clean, 0 lint errors, prettier clean). Tracked debt (FLI-325/231/232/156,
CAR-132 C) confirmed still open and not re-filed. No new issue. Closing `done`.
