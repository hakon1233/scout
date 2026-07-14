# supabase/

Scout v4 (Path 1) database + edge functions. See [`docs`](../docs) and the
architecture doc on PER-2 for the full design.

## Status: current vs. legacy (read before deploying)

This directory is the original Scout v4 **"Path 1" cloud backend**. The current
default brief-generation flow no longer uses the parts tied to the old
browser→Exa/Anthropic path — those were removed in **PER-109**. Briefs are now
synthesized entirely by the local `@scout/agent` companion, which shells out to
the user's local `claude` CLI over a loopback server: no Exa/Anthropic API keys,
no cross-origin calls (see `src/lib/agent.ts`, `src/app/app/page.tsx`, and
[`packages/agent/README.md`](../packages/agent/README.md)).

Two tiers of what's here:

- **Legacy / optional — the retired Exa proxy (PER-109).** Not part of the
  current brief path. Retained (not deleted) pending a decommission decision:
  - `functions/exa-search/` edge function
  - the `EXA_API_KEY` (and `EXA_DAILY_CAP`) function secret
  - the `usage_exa_daily` table and `0002_bump_exa_usage.sql` counter migration

  You do **not** need to deploy `exa-search` or set `EXA_API_KEY` for the current
  local-companion setup.

- **Original Path-1 cloud backend — retained, wiring under review.** The
  `0001_init.sql` schema (+ RLS), the `companion-token` edge function, and the
  `NEXT_PUBLIC_SUPABASE_*` client env belong to the original hosted-Supabase
  design. The current local companion pairs with a **local Bearer token**, not
  the `companion-token` Supabase JWT, so whether any of this is still required
  for a given deployment is an open question tracked by the repo decommission
  audit (see [`docs/audits/2026-07-07-repo-audit.md`](../docs/audits/2026-07-07-repo-audit.md),
  item F10). **Do not delete these files blindly** — confirm the deployment
  target first.

## Layout

- `migrations/` — applied in order with `supabase db push` (cloud) or `supabase db reset` (local).
  - `0001_init.sql` — interests, briefs, articles, companion_pairings, companion_devices, usage_exa_daily; RLS policies.
  - `0002_bump_exa_usage.sql` — **_(legacy — Exa proxy)_** atomic counter bump for the Exa proxy rate limit; only used by `exa-search`.
- `functions/companion-token/` — edge function that exchanges a one-time pairing code for a short-lived Supabase JWT. Part of the original Path-1 cloud pairing flow (see status note above).
- `functions/exa-search/` — **_(legacy / optional — Exa proxy, retired in PER-109)_** edge function that proxies Exa with a per-user daily rate limit. Returns `403 byo_key_required` if `EXA_API_KEY` is unset. Not called by the current local companion.

## Local dev (once Supabase project is provisioned — see [PER-27](/PER/issues/PER-27))

```bash
supabase login
supabase link --project-ref <ref>
supabase db push                                 # apply migrations
supabase functions deploy companion-token        # deploy edge fns

# --- legacy / optional: the retired Exa proxy (PER-109) — skip for local-companion setup ---
supabase functions deploy exa-search             # legacy Exa proxy
supabase secrets set EXA_API_KEY=…               # legacy: shared-key mode (option b)
```

## Constraints

- Edge functions must never log Anthropic OAuth tokens. They never see them — the
  companion shells out to the user's local `claude` CLI. If you ever find yourself
  reaching for `sk-ant-oat01-…` in this directory, stop.
- `companion_pairings` codes are single-use, 10-minute TTL, 96-bit entropy. Don't
  loosen any of those without re-modelling the abuse case.
