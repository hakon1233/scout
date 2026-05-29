# @notiva/agent

Local loopback companion for [Scout](https://github.com/notiva). Runs an HTTP
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
npm i -g https://hakon1233.github.io/scout/agent/notiva-agent-0.3.0.tgz
```

The Connect page (`/app/connect`) always shows the current install command for
the host you opened it from.

## Use

```bash
# one-time: generate a pairing token, paste it into the Scout Connect page
notiva-agent pair

# start the loopback server (default port: 47821; override with --port or NOTIVA_AGENT_PORT)
notiva-agent run

# check state
notiva-agent status
```

## Endpoints

The companion exposes three endpoints, all bound to `127.0.0.1`:

| Method | Path                      | Auth   | Body / Query                        |
| ------ | ------------------------- | ------ | ----------------------------------- |
| GET    | `/healthz`                | none   | —                                   |
| POST   | `/v0/interests`           | Bearer | `{ "interests": ["topic", ...] }`   |
| GET    | `/v0/briefs?since=<iso>`  | Bearer | —                                   |

Auth is `Authorization: Bearer <pairing-token>`.

## State

Everything lives at `~/.config/notiva/state.json` (chmod 0600):

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

Delete the file to un-pair.

## Environment overrides

- `NOTIVA_AGENT_PORT` — bind port (default 47821).
- `NOTIVA_CLAUDE_BIN` — path to the `claude` binary (default `claude` from `PATH`).

## How research works

On each `POST /v0/interests`, the companion spawns one headless `claude`
subprocess with `--dangerously-skip-permissions` and `--allowed-tools
WebSearch,WebFetch,Read,Write`, then pipes a prompt listing the user's
interests. The model decides the queries, reads the pages it needs, and writes
the brief markdown directly to stdout. The companion stores the result in
`last_brief.summary_md`.
