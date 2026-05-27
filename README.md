# Scout

> Scout is a personalised AI news platform.

Set your interests, agents fetch and synthesize a brief with only the news you
care about.

Stack (see PER-2 architecture doc, v2): Next.js 15 (App Router, static export)
hosted on GitHub Pages, Supabase for Postgres + Auth + Edge Functions, Anthropic
Claude (Haiku 4.5 for rank, Opus 4.7 for synthesis), Exa for web search.

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in keys
pnpm dev
```

Open <http://localhost:3000>.

## Running Scout for QA — local sidecar mode

Skip pasting API keys: run the local **`@scout/sidecar`** proxy and let it
talk to Anthropic (using your Claude Code subscription auth) and Exa on your
behalf.

```bash
pnpm install                             # 1. install once
claude login                             # 2. once, if you haven't already
mkdir -p ~/.scout-sidecar && echo 'EXA_API_KEY=exa_...' > ~/.scout-sidecar/.env
pnpm sidecar &                           # 3. start the sidecar on :47832
pnpm dev                                 # 4. start Scout (defaults to local mode)
```

`pnpm dev` sets `NEXT_PUBLIC_SCOUT_BACKEND=local`, so Scout sends
`POST /anthropic/messages` and `POST /exa/search` to
`http://127.0.0.1:47832` and skips the API-key setup step. No
`ANTHROPIC_API_KEY` is required.

To run Scout against your own keys instead (the github.io behaviour), use
`pnpm dev:byo`.

See `packages/sidecar/README.md` for sidecar details.

## Scripts

- `pnpm dev` — Next.js dev server with `NEXT_PUBLIC_SCOUT_BACKEND=local`.
- `pnpm dev:byo` — same, but force the BYO-key path used on github.io.
- `pnpm sidecar` — start the local Anthropic + Exa proxy on `127.0.0.1:47832`.
- `pnpm build` — production build, emits a static site to `out/`.
- `pnpm start` — serve production build (note: `next start` does not serve a static export; run `npx serve out` for local preview).
- `pnpm lint` — ESLint.
- `pnpm typecheck` — TypeScript no-emit check.
- `pnpm format` / `pnpm format:check` — Prettier.

## Environment variables

See `.env.example`. The client only needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. `ANTHROPIC_API_KEY`, `EXA_API_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` are kept in Supabase Edge Function secrets and
never ship in the client bundle.

## Deployment

GitHub Actions builds the static export and deploys to GitHub Pages on every
push to `main` (see `.github/workflows/deploy.yml`). The site is served at
`https://<owner>.github.io/<repo>/`; `next.config.ts` derives the `basePath`
from `GITHUB_REPOSITORY` at build time.
