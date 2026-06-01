# Scout

[![Test & Deploy](https://github.com/hakon1233/scout/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/hakon1233/scout/actions/workflows/deploy.yml)

> Scout is a personalised AI news platform.

Set your interests, agents fetch and synthesize a brief with only the news you
care about.

Stack (see PER-2 architecture doc, v2): Next.js 15 (App Router, static export)
hosted on GitHub Pages, Supabase for Postgres + Auth, and a local loopback
companion (`@scout/agent`) that shells out to the user's own Claude Code CLI
for ranking (Haiku 4.5), synthesis (Opus 4.7), and web research (the CLI's
built-in `WebSearch` + `WebFetch` tools). No server-side Anthropic key, no
third-party search provider — the user's `claude` CLI handles auth from its
own keychain.

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase keys
pnpm dev
```

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

- `pnpm dev` — Next.js dev server (Turbopack).
- `pnpm build` — production build, emits a static site to `out/`.
- `pnpm start` — serve production build (note: `next start` does not serve a static export; run `npx serve out` for local preview).
- `pnpm lint` — ESLint.
- `pnpm typecheck` — TypeScript no-emit check.
- `pnpm format` / `pnpm format:check` — Prettier.

## Environment variables

See `.env.example`. The client only needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase Postgres + Auth, protected by RLS).
Anthropic and web-search credentials are **not** required anywhere in this
repo — the loopback companion (`packages/agent`) delegates to the user's
local Claude Code CLI, which holds its own OAuth token.

## Deployment

GitHub Actions builds the static export and deploys to GitHub Pages on every
push to `main` (see `.github/workflows/deploy.yml`). The site is served at
`https://<owner>.github.io/<repo>/`; `next.config.ts` derives the `basePath`
from `GITHUB_REPOSITORY` at build time.
