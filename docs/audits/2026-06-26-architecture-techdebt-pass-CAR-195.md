# Architecture & Tech-Debt Review — 2026-06-26 (CAR-195)

Recurring Quality-Loop pass (CTO). Scope: architecture / tech-debt only — tangled
modules, leaky abstractions, duplicated logic, risky patterns, missing
error-handling / observability. Bugs, perf, security, design, docs and product
gaps belong to their sibling lanes in this Quality Pass (CAR-188) and are left to
them.

**Baseline & green gate:** typecheck clean; `pnpm test` 131/131 → **133/133**
after this pass (two regression tests added); `eslint` 0 errors / 27 pre-existing
`@next/next/no-img-element` warnings (unchanged).

## Overall read

The `@scout/agent` companion remains healthy and the standing backlog covers the
big structural seams (CAR-132 / CAR-146 / AIR-188): the `server.ts` request-body
+ `ChatDeps` dedup and route table, the confirm-path TOCTOU race, shared browser
hooks, and the global-handler `String(err)` leak / fire-and-forget observability.
Several of those have since landed (a `parseJsonBody()` helper now exists in
`server.ts`; the `void runChatTurn`/`void runSynthesis` tails now `.catch`+log;
`startRun` no longer wedges the run slot on a startup-save throw — CAR-174).

This pass found **one genuinely new, fileable data-loss exposure that no open
issue actually covers** and fixed it directly at the source.

## Fixed directly this pass (small, clearly-safe, behavior-preserving)

1. **A corrupt-but-present chat transcript was silently and permanently wiped on
   the next append** (`packages/agent/src/chat.ts`).

   `readChatTranscript` wrapped read **and** parse in one blanket
   `try { … } catch { return [] }`. The atomic temp+rename in `writeChatTranscript`
   (a prior pass) closed the torn-_write_ source, but the _read_ side still mapped
   **any** failure — including a corrupt-but-fully-present file — to `[]`. The very
   next `appendChatTranscript` reads `[]`, pushes the new turn, and
   `writeChatTranscript`s it back: the user's **entire prior chat history is gone**,
   unrecoverably, from a single bad read. The existing code comment even narrated
   this exact failure path as a known hazard.

   This is **not** the same as the open items: CAR-146 scopes only *logging*
   ("distinguish ENOENT from other errors on transcript read"), not
   truncation-prevention; the data-loss blast radius had no fix planned.

   **Fix:** split read from parse. ENOENT / transient read blips still return `[]`
   (file untouched on disk — safe). But a file that read fine yet fails
   `JSON.parse` is now moved aside to a timestamped `…transcript.json.corrupt-<ts>.bak`
   **before** returning `[]`, so the subsequent write starts from a clean path and
   the original bytes stay recoverable. The backup is pure best-effort (a failure
   logs and falls back to the old behavior — never worse than before). Happy path
   and all three callers (`appendChatTranscript`, the new-turn context builder, and
   `GET /v0/chat`) are unchanged: they still receive `ChatTurn[]`, never throw.

   **Regression tests** (`test/chat.test.ts`):
   - "CAR-195: a corrupt transcript is backed up to `.corrupt-*.bak`, not wiped" —
     writes corrupt JSON, asserts `readChatTranscript` returns `[]` **and** the
     original bytes survive in a `.corrupt-*.bak` sibling.
   - "CAR-195: a missing transcript returns `[]` without creating a backup" — guards
     against spurious backups on the common first-run / ENOENT path.

## Reviewed and deliberately NOT changed / filed

- **`readChatTranscript` non-ENOENT _read_ errors** (permission/IO on a present
  file) still degrade to `[]`. Backing those up is impossible (the read itself
  failed), and the only stronger option — throwing — would turn a transient blip
  into a `GET /v0/chat` 500 and change caller behavior. Left as-is; the observability
  half is already tracked by **CAR-146** (backlog). Out of scope for a "clearly-safe"
  fix.
- **`server.ts` global catch returns `{ error: String(err) }`** without stderr
  logging — tracked by **CAR-146**. Not re-filed.
- **`server.ts` ~1095-LOC god-handler / route-table** — the largest structural
  seam, tracked by CAR-132 / AIR-188 (and partially landed via `parseJsonBody()`).
  Not re-filed.
- **`service.ts` best-effort launchctl `catch`es, `research.ts` SIGTERM→SIGKILL
  `.unref()`, `runner.ts` basis/`bases[]` asymmetry** — re-confirmed intentional /
  documented degradation, not defects (consistent with the CAR-174 pass). No change.

## Net

One genuinely new data-loss exposure — permanent chat-history wipe on a corrupt
transcript read — fixed at the source with a best-effort backup safeguard and two
hermetic regression tests. No new tracking issues needed: the remaining seams are
already covered by CAR-132 / CAR-146 / AIR-188. Build/lint/test green (133 tests).
