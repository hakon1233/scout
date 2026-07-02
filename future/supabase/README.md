# future/supabase/

> **NOT WIRED INTO THE LIVE PRODUCT.** This is a deferred multi-user roadmap
> path (PER-2, PER-27) — no file under `src/` or `packages/` imports anything
> here. The live product is the GitHub Pages static site + local loopback
> companion described in the root [`README.md`](../../README.md). Quarantined
> here per PER-273; do not wire this up without also fixing the exa-search
> quota-before-fetch bug noted below (M2).

Scout v4 (Path 1) database + edge functions. See [`docs`](../../docs) and the
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
- **M2 (open bug):** `functions/exa-search/index.ts` bumps the daily quota
  counter (`bump_exa_usage`) *before* the upstream Exa fetch, so a 5xx from
  Exa still burns the user's quota. Fix this before reviving the path.
