# Architecture & Tech-Debt Review — 2026-07-12

**Scope:** commits since AIR-619 (a358386..HEAD — 4 commits, 12 files)  
**Reviewer:** CTO (AIR-279 quality pass)

---

## What changed

| Commit | Summary | Assessment |
|--------|---------|------------|
| f2a8f89 | Guard stdin writes against EPIPE crash | Correct. Swallow-and-log is right; close handler already settles the promise with the real error. Applied in both chat.ts and research.ts. |
| 5843b3f | Memo ChatMarkdown, dedup cached-base ping, single-parse newest brief | All three correct. Memo dependency is exact (primitive string prop). Ping coalescing is thread-safe in single-threaded JS. newestReadyBrief now finds winner on raw generated_at before the expensive adaptBrief regex parse. |
| 7e9d919 / ace4b75 | CI pnpm pin + e2e dark-token assertions | Housekeeping, no architectural concern. |

---

## Findings

### P1 — Spawn wrapper duplicated across chat.ts and research.ts

**Files:** `packages/agent/src/chat.ts:384`, `packages/agent/src/research.ts:76`  
**Fix issue:** AIR-661

The two "spawn claude, pipe prompt, accumulate stdout/stderr with UTF-8 decoding, map errors" blocks are near-identical. AIR-635 proved the cost: fixing the EPIPE bug required patching both files independently. Shared surface: CLI args, StringDecoder pattern, stdin error guard, error message format, stderr truncation.

**Fix:** Extract `spawnClaude(prompt, claudeBin, spawnFn, args)` into `packages/agent/src/claude-spawn.ts`. Callers layer their own lifecycle (abort signal / timeout) on top.

---

### P2 — No structured logger; 44 raw console.* calls in agent

**Files:** `packages/agent/src/*.ts` (44 sites)  
**Fix issue:** AIR-662

No timestamps, no log levels, no request-ID threading. Correlating a companion failure to a brief run or chat turn requires grep-and-timestamp inference.

**Fix:** `packages/agent/src/log.ts` with `debug/info/warn/error` wrapping `console.error` with ISO timestamp + level prefix. `SCOUT_LOG_LEVEL` env var for suppression.

---

### P3 — companion.ts mixed responsibilities (860 lines)

**File:** `src/lib/companion.ts`  
No fix issue — backlog visibility only.

Discovery/token management, brief polling + adaptation, schedule fetch, run-failure assessment all in one file. Natural first split: extract discovery + token management (~200 lines) into `companion-discovery.ts`. No active bugs; low urgency.

---

### P3 — Non-null assertions on child.stdin/stdout/stderr (6 sites)

**Files:** `packages/agent/src/chat.ts`, `packages/agent/src/research.ts`  
No fix issue — hygiene only.

All safe (`stdio: ["pipe", "pipe", "pipe"]` guarantees streams), but a `spawnWithPipes()` wrapper type would eliminate the `!` noise and surface drift. Addressed incidentally by AIR-661 if the shared util is typed correctly.

---

## No regressions found

Recent changes are architecturally sound. EPIPE fix, memo boundary, ping coalescing, and `newestReadyBrief` optimization are all correctly scoped.
