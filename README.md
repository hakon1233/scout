# Scout

[![Test & Deploy](https://github.com/hakon1233/scout/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/hakon1233/scout/actions/workflows/deploy.yml)

A personalised news reader. Set your interests, and a set of agents fetch, rank and
synthesise a short brief containing only the stories you care about.

**Live:** <https://hakon1233.github.io/scout/>

## The idea worth stealing

An AI product normally means a server holding an API key and paying per token. Scout
does not have one. There is no server-side Anthropic key anywhere in this repository,
and no third-party search provider.

Instead the site is a **static export** on GitHub Pages, and inference runs on the
reader's own machine:

```
Browser (static Next.js on GitHub Pages)
   │
   │  fetch() to 127.0.0.1:47821, authorised by a pairing token
   ▼
@scout/agent — loopback companion on the reader's machine
   │
   │  shells out to the reader's own Claude Code CLI
   ▼
claude CLI ── authenticates from its own keychain
   ├── ranking       (Haiku 4.5)
   ├── synthesis     (Opus 4.7)
   └── web research  (the CLI's built-in WebSearch / WebFetch)

Supabase ── Postgres + Auth for interests and saved briefs, protected by RLS
```

The consequences are the point:

- **No inference bill and no key custody.** Each reader brings their own CLI auth, so
  the hosted part stays a static site with zero running cost.
- **Article content never reaches a server I control.** Research and synthesis happen
  on the reader's machine; only their interests and saved briefs go to Supabase.
- **The trust boundary moves to the loopback port**, which becomes the thing worth
  securing. `packages/agent` pins the origin, requires a pairing token, and is covered
  by tests for origin-spoofing (including suffix attacks such as
  `https://host.tailnet.ts.net.evil.com`) and for token handling.

The cost is honest: the reader must install and run a companion process, so this trades
consumer convenience for zero marginal cost and strong data locality.

## Layout

| Path | What lives there |
|------|------------------|
| `src/` | Next.js App Router UI, static-exported |
| `packages/agent/` | The loopback companion — its own package, separately versioned |
| `supabase/` | Schema and RLS policies |
| `e2e/` | Playwright end-to-end suite |

## Running it

**Prerequisites:** Node 22 and pnpm 11, pinned via `packageManager` in `package.json`.

```bash
corepack enable              # use the pinned pnpm version
pnpm install                 # non-interactive; approved native builds run automatically
cp .env.example .env.local   # fill in Supabase keys
pnpm dev
```

In a second terminal, build and run the companion:

```bash
pnpm -F @scout/agent build
node packages/agent/dist/cli.js pair   # prints a pairing token
node packages/agent/dist/cli.js run    # serves on 127.0.0.1:47821
```

Open <http://localhost:3000>, go to **Connect**, paste the pairing token, and pick
interests.

> **pnpm 11 notes:** dependency `overrides` live in `pnpm-workspace.yaml`, not
> `package.json`. Native dependencies that run install scripts (`esbuild`, `sharp`,
> `unrs-resolver`) are pre-approved via `onlyBuiltDependencies`, so install never stops
> with `ERR_PNPM_IGNORED_BUILDS`. Use `pnpm install --frozen-lockfile` to reproduce CI.

## Tests

```bash
pnpm test        # 234 tests — hermetic @scout/agent unit + /v0 API contract suite
pnpm test:e2e    # Playwright
pnpm typecheck   # tsc --noEmit
```

The unit suite mocks the `claude` shell-out, so it runs fully offline with no model
quota and no network. CI runs it on every push and pull request.

## Environment variables

See `.env.example`. The client needs only `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Anthropic and web-search credentials are **not**
required anywhere in this repository.

## Deployment

GitHub Actions builds the static export and deploys to GitHub Pages on every push to
`main` (`.github/workflows/deploy.yml`). `next.config.ts` derives `basePath` from
`GITHUB_REPOSITORY` at build time, so the site works under `/<repo>/` without
hardcoding it.

The companion deploys separately to a single host. Releases are read-only and named by
their full Git SHA, staged under `~/Library/Application Support/Scout/agent/releases/`.
`pnpm deploy:agent` refuses dirty or unpushed source, waits until both brief and chat
activity are idle, switches the `current` symlink atomically, and restores the previous
release if readiness or provenance checks fail. `GET /v0/version` is the single answer
to "what is live?" — `git_sha` covers the whole immutable artifact, and `next_build_id`
must match the served `/scout-build.json` marker.

## Contributing

See [`AGENTS.md`](AGENTS.md) for the contributor guide — Next.js version caveats and the
test conventions to follow before touching `packages/agent/src/*` or `/v0/*` behaviour.

## Licence

MIT — see [LICENSE](LICENSE).
