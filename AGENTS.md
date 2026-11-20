<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Scout

Read `docs/ARCHITECTURE.md` for the code map and invariants, and `GLOSSARY.md` for the
domain terms (interest, intent doc, run, brief, story, coverage). Use those words in
code, tests and comments.

## Commands

- `pnpm check`: format check, typecheck, lint, unit and contract tests, SQL tests, build. Run it before every commit.
- `pnpm test:e2e`: Playwright against a companion built from source.
- `pnpm demo`: the whole app on <http://127.0.0.1:47899/app/>, offline. Use it to try a
  change by hand.
- `pnpm eval`: check the prompts' rules against hand-written example outputs after
  changing a prompt.
- `pnpm deploy:ideas`: build the hosted web app (served from the root) and deploy it to
  the Cloudflare Pages test site <https://scout-ideas.pages.dev>. Needs
  `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the
  environment. The GitHub Pages site is untouched.
- `pnpm team:run`: the Scout team runner, which researches the catalog's public topics
  with the local `claude` and publishes through the Worker. Off unless
  `SCOUT_TEAM_RUNNER=on`; `--dry-run` publishes nothing, `--only <topic>` runs one
  topic once. See docs/ARCHITECTURE.md, "The Scout team runner".
- `pnpm test:rls`: the hosted schema's RLS and quota tests (`supabase/tests`). Needs
  Docker and `supabase start`; resets the local database first. Not part of `pnpm check`.
- `pnpm test:sql`: the same `supabase/tests` files in PGlite (Postgres in WebAssembly),
  no Docker: each file gets a fresh database with `scripts/sql-test-prelude.sql` (roles,
  `auth` stub, a small pgTAP stand-in) and every migration in order. Part of `pnpm check`;
  `pnpm test:sql voice` runs only matching files. A new pgTAP function a test uses goes
  into the prelude.
- `pnpm test:rls:hosted`: the same tests against a hosted project over the Management
  API, no Docker. Needs `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` (a personal
  access token; never `supabase login`). Each file runs in a transaction that is always
  rolled back, and it checks no rows were left behind. `pnpm db:push:hosted` applies
  pending migrations the same way and records them as `supabase db push` would.

## Rules

- Tests never run the real `claude` and never touch the network. Inject a spawn stub
  (`spawnFn`) or point `SCOUT_CLAUDE_BIN` at `e2e/fixtures/stub-claude.mjs`. Give every
  companion test a temporary state file. A test that writes into the real
  `~/.config/scout` throws.
- Never point manual testing at a real companion (port 47821 and `~/.config/scout`):
  that is someone's actual reading list. Use `pnpm demo`.
- The HTTP contract lives in `packages/core/src/contract.ts`. The web app and the
  companion both import it, so change both sides in one commit. The web app imports
  shared code from `@scout/core` only, and core imports nothing outside its folder
  (`src/lib/boundaries.test.ts`).
- `claude-runner.ts` is the only place a `claude` child starts, and `updateState` is the
  only writer of `state.json`. Keep it that way.
- Push notifications use one VAPID pair. The public key is committed (`wrangler.toml`,
  `scripts/deploy-ideas.mjs`); the private key lives only in the Worker secret
  `VAPID_PRIVATE_KEY` and the hosted env file outside the repo. A new pair cuts off every
  saved device.
- Write a failing test first for a bug fix, at the module's interface (the HTTP routes
  for the companion).
