# Architecture & tech-debt review — 2026-06-26 (AIR-343)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only —
tangled modules, leaky abstractions, duplicated logic, risky patterns, missing
error handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this Quality Pass cycle (AIR-336 children)
and are deliberately left to them.

**Baseline: 138 agent tests pass (`pnpm test`), suite hermetic/offline. `tsc
--noEmit` clean, `eslint` 0 errors. One small clearly-safe fix made directly
(below) with a red-before-green regression test → 139/139. Tree left green. No
paid Apify scrape touched — this pass read code only.**

## Overall read

The codebase remains healthy. The `@scout/agent` companion ↔ Next.js web split
holds. The long line of prior architecture passes (AIR-188 … AIR-300, AIR-315,
AIR-326) plus the FLI-3xx hardening passes have swept the agent engine, the web
glue, and the device-local persistence layer; the localStorage write guard
(AIR-326), the brief/feed date formatter (AIR-300) and the interest slug
(AIR-315) are all single-sourced now.

The remaining large structural items are already filed and open (see
"already-tracked" below) — re-filing them adds noise, not signal. So this pass
focused on finding the one *net-new, small, clearly-safe* gap that genuinely
moves the needle, and fixing it directly.

## Finding — fixed directly this pass (small, reversible)

**`readBuildInfo()` degraded to null on a *missing* build-info.json but 500'd on
a *malformed* one — a hole in its own documented "never fail the endpoint"
contract.**

`packages/agent/src/build-info.ts` backs `GET /v0/version` and the `git_sha`
folded into `/healthz`. Its docstring (lines 10–13) promises: *"When the file is
absent … every field degrades to null rather than failing the endpoint."* The
`/v0/version` contract test echoes this: *"honest degradation: a build without
dist/build-info.json answers 200 with null provenance, never a 500."*

But the implementation used the two-argument promise form:

```ts
fs.readFile(file, "utf8").then(
  (raw) => { const parsed = JSON.parse(raw); ... },  // success
  () => EMPTY,                                        // reject handler
);
```

The `() => EMPTY` reject handler only catches the **`fs.readFile` rejection**
(ENOENT, EACCES). A `JSON.parse` **throw** inside the success callback is *not*
caught by a same-`.then` reject handler — it produces a rejected promise that is
then **cached** (the module memoizes the promise) and propagates out of the
`/v0/version` and `/healthz` handlers as a 500.

A malformed `build-info.json` is a realistic artifact, not a contrived one: an
interrupted/partial build write (`scripts/write-build-info.mjs` truncated by a
crash or full disk), a botched manual edit, or a half-flushed file. The exact
failure mode QA's byte-verify endpoint is supposed to be robust against — a bad
build — is the one that made it 500.

**Fix (committed):** changed the two-arg `.then(onFulfilled, onRejected)` into
`.then(onFulfilled).catch(() => EMPTY)`. `.catch` sits *after* the parse, so it
catches **both** the read rejection (unchanged behavior) **and** the parse throw
(the closed gap). The memoized promise now always resolves — no cached
rejection. Net change: ~6 lines + a comment.

This is **behavior-preserving** for every previously-covered case (present file →
parsed; missing file → EMPTY) and only *adds* graceful degradation for the
malformed case.

**Regression test (red-before-green):** added
`packages/agent/test/version.test.ts` → *"GET /v0/version degrades to null
provenance when build-info.json is malformed (AIR-343)"*. It writes a truncated
`{"git_sha": "96ddc35", ` artifact and asserts 200 + null provenance on both
`/v0/version` and `/healthz`. Verified it **fails** against the old code
(`not ok … 1 fail`) and **passes** with the fix → 139/139.

Verification: `tsc --noEmit` + `eslint` clean on both touched files; `pnpm test`
139/139; prettier-clean.

## Considered and deliberately left (NOT filed — not clearly-safe / lower value)

- **`canonicalUrl()` is hand-copied** across `src/lib/likes.ts:59` (web) and
  `packages/agent/src/weekly.ts:41` (agent) — same ~10-line hash/query/trailing-
  slash stripper. *Not filed:* the web app **deliberately does not import
  `@scout/agent`** (static export shipped to github.io, decoupled from the
  separately-published npm package — the same constraint documented in AIR-272).
  A shared module across that boundary is therefore non-trivial (needs a
  third shared package or a build-time copy), so this is *not* the "clearly-safe
  mechanical extraction" this lane fixes directly, and it overlaps the existing
  decoupling discussion. Left as a noted duplication; revisit only if a shared
  web↔agent utility package is created for another reason.

- **`?mock=` query-param extraction** is duplicated in
  `src/app/app/profile/interest/page.tsx:104` and
  `src/components/profile/useProfileWorkbench.ts:169` (identical
  `params.has("mock") ? params.get("mock") || <fallback> : null`, only the
  fallback string differs). Real but tiny (2 sites, dev-only mock seam) and the
  web layer has no test harness (AIR-129) to guard the extraction, so the
  value/risk ratio doesn't clear the bar this pass. Noted, not filed.

## Verified already-tracked — deliberately NOT re-filed

Confirmed still open and genuinely Scout-relevant this pass:

- **AIR-197** — `server.ts` route-table / `withAuthedJson` refactor (god-handler).
- **AIR-198** — shared `spawnClaude()` + chat per-session timeout + stdout cap.
- **AIR-195** — confirm-delete/rewrite TOCTOU vs. an in-flight chat turn.
- **AIR-196** — `readChatTranscript` blanket `catch { return [] }` wipes history.
- **AIR-177** — `/v0` 500 handler leaks `String(err)` to the client.
- **AIR-178** — unbounded chat transcript growth / whole-file poll read.
- **AIR-179** — observability on best-effort cleanup catches.
- **AIR-129** — no frontend test harness over the pure web seams.
- **AIR-272** — cross-package contract test pinning the web story-date parser.
- **CAR-132 A/B/C** — server body-parse dedup, fire-and-forget observability,
  shared browser read/effect hooks (the write-guard half is done via
  `safe-storage.ts`, AIR-326).

## Method

Read the prior pass (AIR-326) + open arch issues to establish what's tracked.
Ran the baseline (`pnpm test` 138/138, `tsc`, `eslint` — all green). Fanned out a
read-only search for net-new small duplication / missing-guard candidates,
excluding everything already filed. Picked the one correctness-relevant,
clearly-safe gap (`build-info.ts` parse degradation), fixed it, and pinned it
with a red-before-green regression test. No network calls; no Apify scrape.
