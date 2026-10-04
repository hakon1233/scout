<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Working on Scout

Read `docs/ARCHITECTURE.md` for the code map and invariants, and `CONTEXT.md` for the
domain terms (interest, intent doc, run, brief, story, coverage). Use those words in
code, tests and comments.

## Commands

- `pnpm check`: format check, typecheck, lint, unit and contract tests, build. Run it before every commit.
- `pnpm test:e2e`: Playwright against a companion built from source.
- `pnpm demo`: the whole app on <http://127.0.0.1:47899/app/>, offline. Use it to try a
  change by hand.
- `pnpm eval`: score recorded model outputs after changing a prompt.

## Rules

- Tests never run the real `claude` and never touch the network. Inject a spawn stub
  (`spawnFn`) or point `SCOUT_CLAUDE_BIN` at `e2e/fixtures/stub-claude.mjs`. Give every
  companion test a temporary state file. A test that writes into the real
  `~/.config/scout` throws.
- Never point manual testing at a real companion (port 47821 and `~/.config/scout`):
  that is someone's actual reading list. Use `pnpm demo`.
- The HTTP contract lives in `packages/agent/src/contract.ts`. The web app imports it,
  so change both sides in one commit. Only the four modules listed in
  `src/lib/boundaries.test.ts` may be imported by the web app.
- `claude-runner.ts` is the only place a `claude` child starts, and `updateState` is the
  only writer of `state.json`. Keep it that way.
- Write a failing test first for a bug fix, at the module's interface (the HTTP routes
  for the companion).
