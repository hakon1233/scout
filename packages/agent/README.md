# @scout/agent

Local loopback companion for [Scout](https://github.com/hakon1233/scout). Runs an HTTP
server on `127.0.0.1` only. The web app talks to it directly from your browser —
there is no Supabase, no backend, no data leaving your machine except the
outbound calls your local `claude` CLI makes on your behalf.

## Why local

Your Anthropic OAuth token (`sk-ant-oat01-…`) never leaves your machine. Scout
never sees, stores, or relays it. The companion shells out to the `claude`
binary on your `PATH`; the binary handles its own auth.

Research happens through Claude Code's built-in `WebSearch` and `WebFetch`
tools — no third-party search API key required.

## Requires

- Node 20+
- The Claude Code CLI installed and authenticated. `claude --version` must work
  and the account must have WebSearch enabled (the anthropic.com Pro / Max
  subscription does).

## Install

Install the prebuilt, zero-dependency tarball that the Scout site serves from
GitHub Pages — no registry account needed:

```bash
npm i -g https://hakon1233.github.io/scout/agent/scout-agent-0.3.0.tgz
```

The Connect page (`/app/connect`) always shows the current install command for
the host you opened it from.

## Use

```bash
# one-time: generate a pairing token, paste it into the Scout Connect page.
# Re-running reuses the stored token; nothing rotates.
scout-agent pair

# rotate to a brand-new token (invalidates the old one — re-pair the browser after)
scout-agent pair --force   # alias: --reset

# start the loopback server (default port: 47821; override with --port or SCOUT_AGENT_PORT)
scout-agent run

# check state
scout-agent status
```

## Endpoints

The companion exposes three endpoints, all bound to `127.0.0.1`:

| Method | Path                     | Auth   | Body / Query                        |
| ------ | ------------------------ | ------ | ----------------------------------- |
| GET    | `/healthz`               | none   | —                                   |
| GET    | `/v0/version`            | none   | release SHA, UI build ID, busy flag |
| POST   | `/v0/interests`          | Bearer | `{ "interests": ["topic", ...] }`   |
| GET    | `/v0/briefs?since=<iso>` | Bearer | —                                   |

Auth is `Authorization: Bearer <pairing-token>`.

For an already-migrated managed macOS companion, use `pnpm deploy:agent` from
a clean repo at the pushed `origin/main` commit. It stages an immutable
SHA-addressed package under Application Support and keeps launchd pointed at
the stable `current` path; do not install launchd directly from a development
workspace. The first legacy-to-immutable migration is a separately approved
operation; `pnpm release:agent` safely stages its build without activation.

## State

Everything lives at `~/.config/scout/state.json` (chmod 0600):

```json
{
  "pairing_token": "…",
  "last_brief": {
    "id": "…",
    "status": "ready",
    "generated_at": "2026-05-24T12:00:00.000Z",
    "summary_md": "# Your brief\n…"
  }
}
```

Delete the file to un-pair, or run `scout-agent pair --force` to rotate the token in place.

## Environment overrides

- `SCOUT_AGENT_PORT` — bind port (default 47821).
- `SCOUT_CLAUDE_BIN` — path to the `claude` binary (default `claude` from `PATH`).
- `SCOUT_ALLOWED_ORIGINS` — extra browser origins allowed to call the companion,
  as a comma-separated list of exact origins (for example a `tailscale serve`
  URL such as `https://my-mac.example-tailnet.ts.net:48721`). Loopback and the
  hosted UI (`https://hakon1233.github.io`) are always allowed; nothing else is.
- `SCOUT_SESSION_TIMEOUT_MS` — hard ceiling per `claude` run (default 4 minutes).

## Tests

The companion ships a hermetic test suite: it runs fully offline,
mocks the `claude` shell-out, and costs zero Claude quota (no real
WebSearch/WebFetch). It locks the `/v0/*` contract and pins fixes for past
regressions (interest cap, in-flight brief slot, brief render shape, token
never forwarded/logged, token bootstrap, preamble stripping).

```bash
# from the repo root — runs the @scout/agent suite
pnpm test

# or directly
pnpm --filter @scout/agent test
```

`pnpm check` at the repo root runs this suite with typecheck, lint and build. Test files
live in `packages/agent/test/*.test.ts` and use `node:test` + `tsx` (no extra
runner dependency).

## How research works

For each run, the companion spawns one headless `claude` child per interest
(`src/claude-runner.ts`). The child may use only WebSearch and WebFetch
(`--tools WebSearch,WebFetch`), loads no MCP servers, runs in the temp
directory and never bypasses permission checks, so a prompt-injected web page
cannot reach a shell or your files. The model decides the queries, reads the
pages it needs, and writes that interest's brief section to stdout. The chat
child gets no tools at all. The companion assembles the sections and stores
the result in `last_brief.summary_md`.

## Licence

MIT — see [LICENSE](LICENSE).
