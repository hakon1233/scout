<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Tests

`pnpm test` runs the hermetic `@scout/agent` suite (PER-118): unit + `/v0` API
contract tests for the loopback companion. It mocks the `claude` shell-out, so
it runs fully offline with zero Claude quota and no network. CI runs it on
every push/PR. Before touching `packages/agent/src/*` or `/v0/*` behavior, run
`pnpm test` — it guards the known regressions (PER-91/92/106/108/110/113).
Test files: `packages/agent/test/*.test.ts` (`node:test` + `tsx`).

# The founder's live instance is READ-ONLY for QA (PER-293)

The founder's real Scout companion listens on `http://127.0.0.1:47821` with
state in `~/.config/scout/`. That is **production**: their actual interests,
feed, and chat transcript. Two incidents (PER-218 interests clobber, PER-288
QA brief displayed as their real feed) were caused by agents verifying changes
by writing to it.

**The rule: never send a mutating request (POST/PUT/DELETE) to the live
origin.** GET-only checks against 47821 are fine. This covers every write
door, including:

- `POST /v0/chat` and its confirm routes — chat creates, rewrites, and deletes
  interest docs, and the transcript is founder-visible;
- writes flagged `ephemeral: true` — PER-288 happened _through_ the sanctioned
  ephemeral flag, because its output still landed in the shared `last_brief`
  slot the founder's feed reads. The flag is not a safety guarantee.

Before any agent-driven session against the live origin, including GET-only
reads, bracket the session with the live-state guard:

    pnpm --silent live-state-guard snapshot
    # interact with http://127.0.0.1:47821
    pnpm --silent live-state-guard check

Both commands require `PAPERCLIP_RUN_ID` and default to the live state at
`~/.config/scout/`. A clean check is silent and exits 0. Any added, modified,
or deleted `state.json`, interest doc, or chat transcript produces hash-only
evidence attributed to the run and exits 1; stop and post that output in the
issue before doing anything else. The guard never copies or prints state
contents.

Mutating verification runs against the hermetic companion instead. One
command (offline, stub `claude`, throwaway HOME under `e2e/.artifact/home`):

    SCOUT_E2E_PORT=47899 node e2e/start-companion.mjs

Then drive `http://127.0.0.1:47899` freely. The bearer token for `/v0` calls
is `pairing_token` in `e2e/.artifact/home/.config/scout/state.json`. Always
set `SCOUT_E2E_PORT` — the default is 47821, the live port. Kill the process
when done; every byte of its state lives under `e2e/.artifact/home`.

**The only carve-out.** A mutating request to the live origin is allowed only
when ALL three hold:

1. the behavior under test _is_ the live instance's own write path acting on
   the founder's real state — something a hermetic instance cannot exhibit
   (e.g. a migration of their existing config), AND
2. the issue explicitly names the live write as in scope, or the CEO/CTO has
   approved it in that issue's thread, AND
3. you snapshot `~/.config/scout/` before the write, diff after, and post the
   hash-only diff as evidence in the issue using the
   `pnpm --silent live-state-guard` sequence above.

"I judged it necessary" is not a carve-out. If this rule blocks your
verification, that is a comment to the CTO on the issue — not a live write.
