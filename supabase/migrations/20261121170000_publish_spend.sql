-- Publish checks' Haiku calls count against the per-user and global spend caps,
-- like runs, chat turns and picks. publish_checks.cost_usd already holds what
-- each call cost (0 for a check that never reached Haiku).

create or replace function public.user_spend_since(p_user uuid, p_since timestamptz) returns numeric
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce((select sum(coalesce(r.cost_usd, 0.10))
              from public.runs r join public.interests i on i.id = r.interest_id
              where i.owner_id = p_user and r.started_at >= p_since), 0)
  + coalesce((select sum(c.cost_usd) from public.chat_turns c
              where c.user_id = p_user and c.created_at >= p_since), 0)
  + coalesce((select sum(coalesce(k.cost_usd, 0.01)) from public.pick_runs k
              where k.user_id = p_user and k.created_at >= p_since), 0)
  + coalesce((select sum(p.cost_usd) from public.publish_checks p
              where p.user_id = p_user and p.created_at >= p_since), 0)
$$;

create or replace function public.spend_today(p_now timestamptz default now()) returns numeric
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce((select sum(coalesce(cost_usd, 0.10)) from public.runs
              where started_at >= p_now - interval '24 hours'), 0)
  + coalesce((select sum(cost_usd) from public.chat_turns
              where created_at >= p_now - interval '24 hours'), 0)
  + coalesce((select sum(coalesce(cost_usd, 0.01)) from public.pick_runs
              where created_at >= p_now - interval '24 hours'), 0)
  + coalesce((select sum(cost_usd) from public.publish_checks
              where created_at >= p_now - interval '24 hours'), 0)
$$;
