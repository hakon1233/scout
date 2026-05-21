# @notiva/agent

Local news-brief companion for [Notiva](https://github.com/notiva). Runs entirely on your
machine. Reads your interests from Notiva (via Supabase), fetches recent articles via Exa,
and shells out to your locally-authenticated `claude` CLI for synthesis. The resulting
brief is written back to your Notiva account where the web reader picks it up.

## Why local

Your Anthropic OAuth token (`sk-ant-oat01-…`) never leaves your machine. Notiva's servers
never see it, store it, or relay it. We just talk to the `claude` binary on your `PATH`.

## Requires

- Node 20+
- The Claude Code CLI installed and authenticated (`claude --version` should work)
- A Notiva account at the deployed web URL — sign in, set 3+ interests, click **Connect
  your agent**, copy the pairing code

## Use

```bash
# one-time pairing
npx @notiva/agent pair        # paste the pairing code

# generate a brief once
npx @notiva/agent run --once

# poll every 15 minutes
npx @notiva/agent run
```

## Files

- Config + JWT live at `~/.config/notiva/agent.json` (chmod 600). Delete the file to
  un-pair.

## Configuration

Defaults are baked in at publish time. To point at a self-hosted Supabase, override:

```bash
NOTIVA_SUPABASE_URL=…  NOTIVA_SUPABASE_ANON_KEY=…  npx @notiva/agent run --once
```

If Notiva is operating under "BYO Exa" mode (no shared Exa key configured upstream),
add your own Exa key to `~/.config/notiva/agent.json`:

```json
{
  "user_id": "…",
  "access_token": "…",
  "expires_at": 0,
  "exa_key": "exa_…"
}
```
