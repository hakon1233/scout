-- The run queue (docs/HOSTED-PLAN.md, Phase 1 task 5).
--
-- The Cloudflare Worker (packages/worker) calls claim_runs every minute and
-- finish_run once per run; both are service role only. A reader asks for a run
-- with request_run, which only queues it: the next tick picks it up.
--
-- A run's life: queued -> running -> ready, or failed. A failed attempt is
-- queued again once (two attempts in all); the second failure is final and
-- tells the owner. A run left running over 10 minutes (its Worker died)
-- counts as a failed attempt.

alter table public.runs
  add column attempts smallint not null default 0 check (attempts >= 0),
  add column started_at timestamptz;

create index runs_queued_idx on public.runs (scheduled_for) where status = 'queued';
create index runs_started_idx on public.runs (started_at) where started_at is not null;

-- ---------------------------------------------------------------------------
-- Due times
-- ---------------------------------------------------------------------------

-- The latest slot at or before p_now at which an interest should have run:
-- run_at local time in tz, every day (daily) or on run_weekday (weekly).
-- null for cadence 'off'.
create function public.last_run_slot(
  p_cadence text, p_run_at time, p_weekday smallint, p_tz text, p_now timestamptz
) returns timestamptz
language sql stable
set search_path = ''
as $$
  with l as (
    select (p_now at time zone p_tz)::date as d,
           (p_now at time zone p_tz)::time as t,
           extract(isodow from p_now at time zone p_tz)::int as dow
  )
  select case p_cadence
    when 'daily' then
      ((case when l.t >= p_run_at then l.d else l.d - 1 end) + p_run_at) at time zone p_tz
    when 'weekly' then
      ((l.d - (l.dow - p_weekday + 7) % 7
            - case when l.dow = p_weekday and l.t < p_run_at then 7 else 0 end)
       + p_run_at) at time zone p_tz
  end
  from l
$$;

-- ---------------------------------------------------------------------------
-- Spending: the global daily ceiling and the kill switch
-- ---------------------------------------------------------------------------

-- Dollars spent on the UTC day of p_now: runs (by their last start) and chat turns.
create function public.spend_today(p_now timestamptz default now()) returns numeric
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce((select sum(cost_usd) from public.runs
              where started_at >= date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC'), 0)
  + coalesce((select sum(cost_usd) from public.chat_turns
              where created_at >= date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC'), 0)
$$;

-- Whether new paid work (a run or a chat turn) may start: the kill switch is
-- off and today's spend is under the ceiling. Work already started finishes,
-- so the ceiling can be overshot by the runs in flight.
create function public.spending_open(p_now timestamptz default now()) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not s.paused and public.spend_today(p_now) < s.daily_ceiling_usd
  from public.settings s
$$;

-- ---------------------------------------------------------------------------
-- Failing an attempt
-- ---------------------------------------------------------------------------

-- The first failure queues the run again; the second is final and writes a
-- run_failed notification to the interest's owner.
create function public.fail_run_attempt(p_run uuid, p_error text, p_now timestamptz)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_run public.runs;
begin
  update public.runs r set
    status = case when r.attempts < 2 then 'queued' else 'failed' end,
    error_msg = left(p_error, 1000),
    finished_at = case when r.attempts < 2 then null else p_now end
  where r.id = p_run and r.status = 'running'
  returning * into v_run;

  if v_run.status = 'failed' then
    insert into public.notifications (user_id, kind, payload)
    select i.owner_id, 'run_failed',
           jsonb_build_object('interest_id', i.id, 'topic', i.topic,
                              'run_id', v_run.id, 'error', v_run.error_msg)
    from public.interests i where i.id = v_run.interest_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_runs: one Worker tick
-- ---------------------------------------------------------------------------

-- In order:
--   1. reap: running runs older than 10 minutes fail an attempt (research times
--      out at 5 minutes, so their Worker is gone); queued runs of deleted
--      interests fail;
--   2. stop here when the kill switch is on or today's spend is at the ceiling
--      (queued runs wait; missed slots run once when spending reopens);
--   3. queue every due scheduled interest (single flight: one queued or running
--      run per interest);
--   4. claim up to p_limit queued runs, public interests first, then oldest,
--      skipping rows another tick holds. Each claimed run is marked running.
-- Returns what the Worker needs to research each claimed run.
create function public.claim_runs(p_limit integer, p_now timestamptz default now())
returns table (run_id uuid, topic text, doc text, searches_per_run integer)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_stale uuid;
begin
  for v_stale in
    select r.id from public.runs r
    where r.status = 'running' and r.started_at < p_now - interval '10 minutes'
    for update skip locked
  loop
    perform public.fail_run_attempt(v_stale, 'the run stopped without a result', p_now);
  end loop;

  update public.runs r set status = 'failed', error_msg = 'interest deleted', finished_at = p_now
  from public.interests i
  where i.id = r.interest_id and r.status = 'queued' and i.deleted_at is not null;

  if not public.spending_open(p_now) then
    return;
  end if;

  insert into public.runs (interest_id, scheduled_for)
  select i.id, s.slot
  from public.interests i
  left join public.profiles pr on pr.id = i.owner_id
  cross join lateral (
    select public.last_run_slot(i.cadence, i.run_at, i.run_weekday,
                                coalesce(pr.timezone, 'UTC'), p_now) as slot
  ) s
  where i.cadence in ('daily', 'weekly') and i.deleted_at is null
    and s.slot >= i.created_at
    and not exists (
      select 1 from public.runs r
      where r.interest_id = i.id and r.requested_by is null and r.scheduled_for >= s.slot)
  on conflict (interest_id) where status in ('queued', 'running') do nothing;

  return query
  with picked as (
    select r.id
    from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.status = 'queued' and r.scheduled_for <= p_now
    order by (i.visibility = 'public') desc, r.scheduled_for, r.created_at
    limit greatest(p_limit, 0)
    for update of r skip locked
  ), claimed as (
    update public.runs r
    set status = 'running', started_at = p_now, attempts = r.attempts + 1
    from picked where r.id = picked.id
    returning r.id, r.interest_id
  )
  select c.id, i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int
  from claimed c join public.interests i on i.id = c.interest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_run: one run's result
-- ---------------------------------------------------------------------------

-- Records the result of a running run. The cost adds up across attempts, so the
-- ceiling sees every dollar. p_section_md null means the attempt failed
-- (p_error says why). Returns false when the run was no longer running (it was
-- reaped), in which case only the cost is recorded.
create function public.finish_run(
  p_run uuid,
  p_section_md text,
  p_coverage jsonb,
  p_searches integer,
  p_cost_usd numeric,
  p_error text default null,
  p_now timestamptz default now()
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_running boolean;
begin
  update public.runs
  set cost_usd = coalesce(cost_usd, 0) + greatest(coalesce(p_cost_usd, 0), 0),
      searches = coalesce(searches, 0) + greatest(coalesce(p_searches, 0), 0),
      coverage = coalesce(p_coverage, coverage)
  where id = p_run
  returning status = 'running' into v_running;

  if not coalesce(v_running, false) then
    return false;
  end if;

  if p_section_md is null then
    perform public.fail_run_attempt(p_run, coalesce(p_error, 'no section'), p_now);
  else
    update public.runs
    set status = 'ready', section_md = p_section_md, error_msg = null, finished_at = p_now
    where id = p_run;
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- request_run: a reader's "run now"
-- ---------------------------------------------------------------------------

-- Queues an on-demand run of one of the caller's own live interests and returns
-- its id. When the interest already has a queued or running run, returns that
-- one and counts nothing. Limited per day by on_demand_runs_per_day.
create function public.request_run(p_interest uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_run uuid;
  v_allow jsonb;
begin
  if v_user is null then
    raise exception 'request_run: sign in first' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.interests
    where id = p_interest and owner_id = v_user and deleted_at is null
  ) then
    raise exception 'request_run: no such interest' using errcode = 'P0002';
  end if;

  -- Serialise per user so two requests cannot both take the last run.
  perform pg_advisory_xact_lock(hashtext('run-request:' || v_user::text));

  select id into v_run from public.runs
  where interest_id = p_interest and status in ('queued', 'running');
  if found then
    return v_run;
  end if;

  v_allow := public.allowance(v_user);
  if (v_allow -> 'used' ->> 'on_demand_runs_today')::int
     >= (v_allow -> 'limits' ->> 'on_demand_runs_per_day')::int then
    raise exception 'quota: % of % on-demand runs used today',
      v_allow -> 'used' ->> 'on_demand_runs_today',
      v_allow -> 'limits' ->> 'on_demand_runs_per_day'
      using errcode = 'P0001', hint = 'on_demand_runs_per_day';
  end if;

  insert into public.runs (interest_id, requested_by) values (p_interest, v_user)
  returning id into v_run;
  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.last_run_slot(text, time, smallint, text, timestamptz),
  public.spend_today(timestamptz), public.spending_open(timestamptz),
  public.fail_run_attempt(uuid, text, timestamptz), public.claim_runs(integer, timestamptz),
  public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz),
  public.request_run(uuid)
  from public, anon, authenticated;

grant execute on function public.claim_runs(integer, timestamptz),
  public.finish_run(uuid, text, jsonb, integer, numeric, text, timestamptz),
  public.spending_open(timestamptz), public.spend_today(timestamptz)
  to service_role;
grant execute on function public.request_run(uuid) to authenticated;
