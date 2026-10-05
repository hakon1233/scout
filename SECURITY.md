# Security

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a
vulnerability"). Don't open a public issue. This is a personal project, so expect a
reply within about a week.

## Threat model in short

Scout has no server of its own. The static site on GitHub Pages holds no secrets;
the sensitive part is the **companion** (`packages/agent`), a small HTTP server on the
reader's machine that can start their local `claude` CLI.

| Asset                          | Protection                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The companion's HTTP interface | Binds `127.0.0.1` only. Every request's `Host` must be loopback or a configured origin's host (defeats DNS rebinding). Browser `Origin`s must be loopback, the hosted UI, or listed in `SCOUT_ALLOWED_ORIGINS` (exact match, no wildcards).                                                                                                                                                                                                                         |
| Write and read routes          | Need the pairing token (`Authorization: Bearer …`), compared in constant time.                                                                                                                                                                                                                                                                                                                                                                                      |
| The pairing token              | Lives in `~/.config/scout/state.json` (mode 600). `GET /v0/config` hands it only to same-origin browser fetches (`Sec-Fetch-Site: same-origin` or a matching `Origin`).                                                                                                                                                                                                                                                                                             |
| The reader's machine           | Research reads untrusted web pages, so the `claude` child gets only `WebSearch` and `WebFetch` (chat gets no tools), loads no MCP servers, never bypasses permission checks, and runs in the temp directory. It also starts without your own Claude Code setup (`--safe-mode`, `--setting-sources ""`: no `CLAUDE.md`, skills, plugins, hooks or settings files) and with only the environment it needs to run and sign in (`packages/agent/src/claude-runner.ts`). |
| Interest docs                  | File names are minted by the companion, never taken from the model or the request.                                                                                                                                                                                                                                                                                                                                                                                  |
| The app page                   | Every response forbids framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) and content sniffing, so another site can't overlay the page that holds the token.                                                                                                                                                                                                                                                                                               |

## Known, accepted risks

- **Shared origin for the hosted UI.** When Scout is used from
  `https://hakon1233.github.io/scout/`, the pairing token is kept in that origin's
  `localStorage`, which every site under `hakon1233.github.io` shares. Using the UI the
  companion serves itself (`http://127.0.0.1:47821/app/`) avoids this.
- **No rate limiting.** Spend is bounded instead: one research run and one chat turn at
  a time (`409` while one is in flight) and a per-run timeout.
- **`WebFetch` can reach your local network.** A page with injected instructions could
  get the research session to fetch an address on your LAN. The session holds only its
  prompt (one interest's topic and intent doc), and its output is only text in your
  brief.
- **`/v0/config` behind a proxy.** Its same-origin check reads browser-set headers
  (`Sec-Fetch-Site`, `Origin`), which a non-browser client can fake. On loopback only
  local programs can call it; if you expose the companion with `tailscale serve` or
  another proxy, anyone who can reach that URL can read the pairing token. Never expose
  it publicly (for example with Tailscale Funnel).
- **Old pull-request refs.** Closed PR refs on GitHub predate a history cleanup and still
  contain a private hostname. They contain no credentials.
