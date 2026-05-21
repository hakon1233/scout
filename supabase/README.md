# supabase/

Notiva v4 (Path 1) database + edge functions. See [`docs`](../docs) and the
architecture doc on PER-2 for the full design.

## Layout

- `migrations/` — applied in order with `supabase db push` (cloud) or `supabase db reset` (local).
  - `0001_init.sql` — interests, briefs, articles, companion_pairings, companion_devices, usage_exa_daily; RLS policies.
  - `0002_bump_exa_usage.sql` — atomic counter bump for the Exa proxy rate limit.
- `functions/companion-token/` — edge function that exchanges a one-time pairing code for a short-lived Supabase JWT.
- `functions/exa-search/` — edge function that proxies Exa with a per-user daily rate limit. Returns `403 byo_key_required` if `EXA_API_KEY` is unset.

## Local dev (once Supabase project is provisioned — see [PER-27](/PER/issues/PER-27))

```bash
supabase login
supabase link --project-ref <ref>
supabase db push                                 # apply migrations
supabase functions deploy companion-token        # deploy edge fns
supabase functions deploy exa-search
supabase secrets set EXA_API_KEY=…               # for shared-key mode (option b)
```

## Constraints

- Edge functions must never log Anthropic OAuth tokens. They never see them — the
  companion shells out to the user's local `claude` CLI. If you ever find yourself
  reaching for `sk-ant-oat01-…` in this directory, stop.
- `companion_pairings` codes are single-use, 10-minute TTL, 96-bit entropy. Don't
  loosen any of those without re-modelling the abuse case.
