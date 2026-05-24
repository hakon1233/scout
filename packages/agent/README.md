# @notiva/agent

Local loopback companion for [Notiva](https://github.com/notiva). Runs an HTTP
server on `127.0.0.1` only. The Notiva web app talks to it directly from your
browser — there is no Supabase, no backend, no data leaving your machine
except outbound calls you authorize (Exa search, your local `claude` CLI).

## Why local

Your Anthropic OAuth token (`sk-ant-oat01-…`) never leaves your machine. Notiva
never sees, stores, or relays it. The companion shells out to the `claude`
binary on your `PATH`; the binary handles its own auth.

## Requires

- Node 20+
- The Claude Code CLI installed and authenticated (`claude --version` should work)
- An Exa API key (the v0 companion uses BYO Exa — no shared proxy)

## Use

```bash
# one-time: generate a pairing token, paste it into the Notiva Connect page
npx @notiva/agent pair

# start the loopback server (default port: 47821; override with --port or NOTIVA_AGENT_PORT)
npx @notiva/agent run

# check state
npx @notiva/agent status
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
  "exa_key": "exa_…",
  "last_brief": {
    "id": "…",
    "status": "ready",
    "generated_at": "2026-05-24T12:00:00.000Z",
    "summary_md": "# Your brief\n…",
    "articles": [{ "interest": "…", "title": "…", "url": "…" }]
  }
}
```

Delete the file to un-pair.

## Environment overrides

- `NOTIVA_AGENT_PORT` — bind port (default 47821).
- `NOTIVA_CLAUDE_BIN` — path to the `claude` binary (default `claude` from `PATH`).
