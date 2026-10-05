# @scout/agent

Local loopback companion for [Scout](https://github.com/hakon1233/scout). Runs an HTTP
server on `127.0.0.1` only and serves the Scout web app from that origin. No data
leaves your machine except the calls your local `claude` CLI makes on your behalf.

## Why local

Your Anthropic OAuth token (`sk-ant-oat01-…`) never leaves your machine. Scout
never sees, stores, or relays it. The companion shells out to the `claude`
binary on your `PATH`; the binary handles its own auth.

Research happens through Claude Code's built-in `WebSearch` and `WebFetch`
tools — no third-party search API key required.

## Requires

- Node 20+
- The Claude Code CLI, 2.1.289 or newer (the companion starts it with
  `--safe-mode`), installed and authenticated. `claude --version` must work
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
# one-time: generate a pairing token. The web app served by `run` picks it up by
# itself; re-running reuses the stored token.
scout-agent pair

# rotate to a brand-new token (invalidates the old one — re-pair the browser after)
scout-agent pair --force   # alias: --reset

# start the loopback server (default port: 47821; override with --port or SCOUT_AGENT_PORT)
scout-agent run

# check state
scout-agent status

# macOS: start at login so the daily brief survives a reboot
scout-agent install-service
```

## Endpoints

All bound to `127.0.0.1`. Shapes and paths are defined in `src/contract.ts`; the
route table with each route's auth level is `src/routes/index.ts`.

| Method         | Path                                                                   | Auth             | Purpose                                                                    |
| -------------- | ---------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| GET            | `/healthz`, `/v0/version`                                              | none             | liveness; running version and build                                        |
| GET            | `/v0/config`                                                           | same-origin page | hands the pairing token to the page the companion serves                   |
| GET, PUT, POST | `/v0/interests`                                                        | Bearer           | read the interests with their intent docs; save them; save and start a run |
| GET            | `/v0/briefs`                                                           | Bearer           | the latest brief (`?since=`) or the history (`?limit=&offset=`)            |
| POST           | `/v0/weekly-brief`                                                     | Bearer           | assemble a weekly brief from the past week                                 |
| GET, PUT       | `/v0/schedule`                                                         | Bearer           | the daily run's time and last result                                       |
| GET, POST      | `/v0/chat`                                                             | Bearer           | the chat transcript; start a turn                                          |
| POST           | `/v0/chat/stop`, `/v0/chat/confirm-delete`, `/v0/chat/confirm-rewrite` | Bearer           | stop a turn; confirm a proposed delete or rewrite                          |

Auth is `Authorization: Bearer <pairing-token>`. Releases of the companion are
immutable, commit-named builds switched by `pnpm deploy:agent`
(see `docs/adr/0003-immutable-companion-releases.md` at the repo root).

## State

Everything lives under `~/.config/scout/` (owner-only):

- `state.json`: the pairing token, interests, schedule, the latest brief and
  the brief history;
- `interests/<id>.md`: each interest's intent doc;
- `chat/transcript.json`: the chat history.

Delete `state.json` to un-pair, or run `scout-agent pair --force` to rotate the token in place.

## Environment overrides

- `SCOUT_AGENT_PORT` — bind port (default 47821).
- `SCOUT_CLAUDE_BIN` — path to the `claude` binary (default `claude` from `PATH`).
- `SCOUT_ALLOWED_ORIGINS` — extra browser origins allowed to call the companion,
  as a comma-separated list of exact origins (for example a `tailscale serve`
  URL such as `https://my-mac.example.net:48721`). Loopback and the
  hosted UI (`https://hakon1233.github.io`) are always allowed; nothing else is.
- `SCOUT_SESSION_TIMEOUT_MS` — hard ceiling per `claude` run (default 4 minutes).
- `SCOUT_CLAUDE_MODEL` — model for research and chat, passed as `--model` (for
  example `sonnet`). Unset, the CLI's default model is used: the companion starts
  `claude` without your Claude Code settings, so a model set there doesn't apply.

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
has no shell and no file tools to use (see `SECURITY.md` for what it can still try). The model decides the queries, reads the
pages it needs, and writes that interest's brief section to stdout. The chat
child gets no tools at all. The companion assembles the sections and stores
the result in `last_brief.summary_md`.

## Licence

MIT — see [LICENSE](LICENSE).
