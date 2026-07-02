# Scout

[![Test & Deploy](https://github.com/hakon1233/scout/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/hakon1233/scout/actions/workflows/deploy.yml)

> Scout is a personalised AI news platform.

Set your interests, agents fetch and synthesize a brief with only the news you
care about.

Stack (see PER-2 architecture doc, v2): Next.js 15 (App Router, static export)
hosted on GitHub Pages, plus a local loopback companion (`@scout/agent`) that
shells out to the user's own Claude Code CLI for ranking (Haiku 4.5),
synthesis (Opus 4.7), and web research (the CLI's built-in `WebSearch` +
`WebFetch` tools). No server-side Anthropic key, no third-party search
provider — the user's `claude` CLI handles auth from its own keychain.

A multi-user Supabase + Exa path exists as a deferred roadmap item, quarantined
under [`future/supabase/`](future/supabase/README.md) and not wired into the
live product described above.

## Local development

```bash
pnpm install
pnpm dev
```

No `.env.local` needed for the live product — the client and companion read
zero environment secrets. `.env.example` documents variables for the
quarantined [`future/supabase/`](future/supabase/README.md) path only.

In a second terminal, build and run the loopback companion:

```bash
pnpm -F @scout/agent build
node packages/agent/dist/cli.js pair   # prints a pairing token
node packages/agent/dist/cli.js run    # serves on 127.0.0.1:47821
```

Open <http://localhost:3000>, go to **Connect**, paste the pairing token,
and pick interests. The web app talks only to the loopback server; the
companion shells out to your local `claude` CLI, which authenticates from
its own keychain. No `ANTHROPIC_API_KEY` or web-search API key needed.

## Scripts

- `pnpm dev` — Next.js dev server.
- `pnpm build` — production build, emits a static site to `out/`.
- `pnpm start` — serve the static export from `out/` via `npx serve`.
- `pnpm lint` — ESLint.
- `pnpm typecheck` — TypeScript no-emit check.
- `pnpm format` / `pnpm format:check` — Prettier.
- `pnpm test` — hermetic `@scout/agent` suite (unit + `/v0` API contract
  tests). Mocks the `claude` shell-out, so it runs fully offline with no
  Claude quota or network. CI runs it on every push/PR.
- `pnpm test:e2e` — Playwright end-to-end suite (`e2e/`).
- `pnpm build:agent` / `pnpm pack:agent` — build and pack the loopback
  companion (`packages/agent`) for distribution.

## Environment variables

See `.env.example` — every variable there belongs to the quarantined
[`future/supabase/`](future/supabase/README.md) path (companion-token minter +
Exa search proxy) and is **not required** for local dev or the live product.
The client and the loopback companion (`packages/agent`) read zero
environment secrets; the companion delegates to the user's local Claude Code
CLI, which holds its own OAuth token.

## Deployment

GitHub Actions builds the static export and deploys to GitHub Pages on every
push to `main` (see `.github/workflows/deploy.yml`). The site is served at
`https://<owner>.github.io/<repo>/`; `next.config.ts` derives the `basePath`
from `GITHUB_REPOSITORY` at build time.

## Contributing

See [`AGENTS.md`](AGENTS.md) for the agent/contributor working guide —
Next.js version caveats and the test conventions to follow before touching
`packages/agent/src/*` or `/v0/*` behavior.
