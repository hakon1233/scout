# Notiva

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

## Scripts

- `pnpm dev` — Next.js dev server (Turbopack).
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
