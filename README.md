# Notiva

Personalized AI news platform. Set your interests, agents fetch and synthesize
a brief with only the news you care about.

Stack (see PER-2 architecture doc): Next.js 15 (App Router) + TypeScript on
Vercel, Postgres on Neon via Drizzle, Auth.js + Resend, Anthropic Claude
(Haiku 4.5 for rank, Opus 4.7 for synthesis), Exa for web search.

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in keys
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

- `pnpm dev` — Next.js dev server (Turbopack).
- `pnpm build` — production build.
- `pnpm start` — serve production build.
- `pnpm lint` — ESLint.
- `pnpm typecheck` — TypeScript no-emit check.
- `pnpm format` / `pnpm format:check` — Prettier.

## Environment variables

See `.env.example`. The MVP scaffold only requires `ANTHROPIC_API_KEY` and
`EXA_API_KEY` once feature work begins; auth/database variables are wired in
PER-4.

## Deployment

Deployed to Vercel. The `main` branch is the production environment; PR
branches get automatic preview deployments.
