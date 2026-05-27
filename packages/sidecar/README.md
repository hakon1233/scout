# @scout/sidecar

Local-only HTTP proxy that lets Scout call Anthropic and Exa from a browser
without baking API keys into the static build.

- **Anthropic** is authenticated with the OAuth bearer that `claude login`
  stores in the macOS keychain (`Claude Code-credentials`). No
  `ANTHROPIC_API_KEY` required.
- **Exa** is authenticated with a key read from `~/.scout-sidecar/.env`
  (Exa has no subscription auth — only keys).

Binds to `127.0.0.1` only. CORS allows `http://localhost:*` and
`http://127.0.0.1:*` only.

## Endpoints

| Method | Path                  | Purpose                                                   |
| ------ | --------------------- | --------------------------------------------------------- |
| GET    | `/healthz`            | liveness check                                            |
| POST   | `/anthropic/messages` | proxies to `https://api.anthropic.com/v1/messages`        |
| POST   | `/exa/search`         | proxies to `https://api.exa.ai/search`                    |

The Anthropic proxy prepends a `You are Claude Code, …` system block (required
when authenticating with a Claude Code OAuth bearer) before forwarding to
upstream. The Scout app does not have to change its request shape.

Each upstream call logs `model`, `tokens_in`, `tokens_out` (no PII, no prompt
body) so quota / rate-limit issues are easy to spot.

## Running

```bash
# one-time, if you haven't already
claude login

# put your Exa key somewhere the sidecar can find it
mkdir -p ~/.scout-sidecar
echo 'EXA_API_KEY=exa_...' > ~/.scout-sidecar/.env

# from the scout repo root
pnpm --filter @scout/sidecar dev          # default port 47832
# or, with an explicit port:
pnpm --filter @scout/sidecar dev -- --port=47832
```

## Environment overrides

- `SCOUT_SIDECAR_PORT` — bind port (default `47832`).
- `EXA_API_KEY` — overrides the value in `~/.scout-sidecar/.env`.
