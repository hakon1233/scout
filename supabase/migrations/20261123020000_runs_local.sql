-- Local accounts: an account whose runs the Scout team runner does on Håkon's
-- Mac (the local `claude` CLI on his subscription) instead of the Worker's API
-- calls. profiles.runs_local marks one. Every topic of a local account, private
-- or public, runs on the Mac; the Worker's claim_runs never takes one. Sharing
-- and publishing work as for any account.
--
-- Set by hand (as postgres), like is_team; a reader cannot write it (column
-- grants on profiles stay as they are):
--   update public.profiles set runs_local = true where id = '<user id>';
--
-- One check, runs_on_mac, replaces is_team_topic wherever it chose the runner:
-- a Scout team public topic, or any topic of a local account. A local account
-- also skips the runs-per-day and spend caps at claim time, as team accounts
-- do: its runs cost no API dollars.

alter table public.profiles add column runs_local boolean not null default false;

create function public.runs_on_mac(p_owner uuid, p_visibility text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select pr.runs_local or (pr.is_team and p_visibility = 'public')
                   from public.profiles pr where pr.id = p_owner), false)
$$;

revoke execute on function public.runs_on_mac(uuid, text) from public, anon, authenticated;

-- As in 20261121070000_team_runner, with runs_on_mac.
create or replace function public.queue_due_runs(p_now timestamptz, p_team boolean)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.runs (interest_id, scheduled_for, created_at)
  select d.interest_id, d.slot, p_now
  from public.due_interests(p_now) d
  join public.interests i on i.id = d.interest_id
  where public.runs_on_mac(i.owner_id, i.visibility) = p_team
  on conflict (interest_id) where status in ('queued', 'running') do nothing
$$;

-- As in 20261123010000_make_mode, with runs_on_mac; local accounts skip the
-- runs-per-day and spend caps like team accounts.
create or replace function public.claim_queued(p_limit integer, p_now timestamptz, p_team boolean)
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz,
  mode text, sent_keys text[]
)
language sql security definer
set search_path = ''
as $$
  with ranked as (
    select r.id, i.owner_id,
           row_number() over (partition by i.owner_id
                              order by r.scheduled_for, r.created_at) as n
    from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.status = 'queued' and r.scheduled_for <= p_now
      and public.runs_on_mac(i.owner_id, i.visibility) = p_team
      and (i.mode = 'news' or exists (select 1 from public.settings where make_on))
  ), eligible as (
    select ranked.id
    from ranked
    left join public.profiles pr on pr.id = ranked.owner_id
    join public.plans pl on pl.id = coalesce(pr.plan, 'free')
    where coalesce(pr.is_team, false) or coalesce(pr.runs_local, false)
       or (public.user_runs_since(ranked.owner_id, p_now - interval '24 hours') + ranked.n
             <= pl.runs_per_day
           and public.user_spend_since(ranked.owner_id, p_now - interval '24 hours')
               + (ranked.n - 1) * 0.10 < pl.spend_per_day_usd)
  ), picked as (
    select r.id
    from public.runs r
    where r.id in (select eligible.id from eligible) and r.status = 'queued'
    order by r.scheduled_for, r.created_at
    limit greatest(p_limit, 0)
    for update skip locked
  ), claimed as (
    update public.runs r
    set status = 'running', started_at = p_now, attempts = r.attempts + 1
    from picked where r.id = picked.id
    returning r.id, r.interest_id
  )
  select c.id, f.*
  from claimed c cross join lateral public.run_facts(c.interest_id) f
$$;

-- As in 20261121070000_team_runner, with runs_on_mac.
create or replace function public.team_topics(p_now timestamptz default now())
returns table (interest_id uuid, topic text, doc text, searches_per_run integer, due boolean)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int,
         i.id in (select d.interest_id from public.due_interests(p_now) d)
           or exists (select 1 from public.runs r
                      where r.interest_id = i.id and r.status = 'queued'
                        and r.scheduled_for <= p_now)
  from public.interests i
  where public.runs_on_mac(i.owner_id, i.visibility)
    and i.deleted_at is null and i.hidden_at is null
  order by i.topic
$$;

-- As in 20261123010000_make_mode, with runs_on_mac.
create or replace function public.team_start_run(p_interest uuid, p_now timestamptz default now())
returns table (
  run_id uuid, topic text, doc text, searches_per_run integer,
  brief_length text, story_count smallint, stories_relevant_only boolean,
  evergreen boolean, search_locale text, brief_language text,
  prior jsonb, cadence text, last_story_at timestamptz,
  mode text, sent_keys text[]
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_run uuid;
begin
  if not exists (select 1 from public.settings where team_runner_on and not paused) then
    raise exception 'team_start_run: the team runner is off' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.interests i
    where i.id = p_interest and public.runs_on_mac(i.owner_id, i.visibility)
      and i.deleted_at is null and i.hidden_at is null
  ) then
    raise exception 'team_start_run: no such topic for the Mac' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.interests i where i.id = p_interest and i.mode = 'make')
     and not exists (select 1 from public.settings where make_on) then
    raise exception 'team_start_run: make mode is off' using errcode = '55000';
  end if;
  insert into public.runs (interest_id, scheduled_for, status, started_at, attempts)
  values (p_interest, p_now, 'running', p_now, 1)
  returning id into v_run;
  return query select v_run, f.* from public.run_facts(p_interest) f;
end;
$$;

-- As in 20261123000000_usage_logging, with runs_on_mac.
create or replace function public.team_finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_error text default null,
  p_now timestamptz default now(),
  p_usage jsonb default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  u jsonb := case when jsonb_typeof(p_usage) = 'object' then p_usage end;
begin
  if not exists (
    select 1 from public.runs r join public.interests i on i.id = r.interest_id
    where r.id = p_run and public.runs_on_mac(i.owner_id, i.visibility)
  ) then
    raise exception 'team_finish_run: not a run for the Mac' using errcode = 'P0002';
  end if;
  return public.finish_run(
    p_run, p_section_md, p_coverage,
    coalesce((u ->> 'webSearches')::integer, 0), 0, p_error, p_now, true,
    (u ->> 'inputTokens')::bigint, (u ->> 'outputTokens')::bigint,
    (u ->> 'cacheReadTokens')::bigint, (u ->> 'cacheWriteTokens')::bigint,
    p_web_fetches => (u ->> 'webFetches')::integer,
    p_model => u ->> 'model',
    p_stop_reason => u ->> 'stopReason',
    p_requests => (u ->> 'turns')::integer,
    p_cli_cost_usd => (u ->> 'costUsd')::numeric);
end;
$$;

-- Nothing calls it any more.
drop function public.is_team_topic(uuid, text);
