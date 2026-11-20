-- Per-user limits that cannot be reset or stepped around
-- (plan/research/fable-review.md items 3, 12, 20, 24, 30; plan/research/pricing.md).
--
-- * Every per-user count, and the per-user spend cap, is over the rolling 24
--   hours before now, never a calendar day (changing time zone resets nothing).
-- * A claimed run with no recorded cost counts as $0.10 in every spend sum, so a
--   Worker killed mid-run still costs its owner.
-- * Spend cap per owner: plans.spend_per_day_usd (free $0.40, plus $0.80). Runs
--   per owner: plans.runs_per_day. Team accounts (profiles.is_team) skip both.
-- * claim_runs queues at most one scheduled run per interest per 20 hours (daily)
--   or 6 days (weekly), whatever run_at, cadence or time zone edits happen;
--   paused interests get none; public interests no longer go first.
-- * Public interests count on the owner's quota like any other; at most
--   plans.max_public_interests (3) each.
-- * A chat turn is reserved (a pending row, under a per-user lock) before the
--   Worker calls Claude, so parallel requests cannot pass the turn limit.
-- * The time zone is set once from the browser, then only from Settings.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

alter table public.plans
  add column spend_per_day_usd numeric(10, 2) not null default 0.40 check (spend_per_day_usd >= 0),
  add column runs_per_day integer not null default 8 check (runs_per_day >= 0),
  add column max_public_interests integer not null default 3 check (max_public_interests >= 0);

-- The paid plan (pricing.md): more daily topics, twice the spend.
insert into public.plans
  (id, daily_interests, weekly_interests, on_demand_runs_per_day, chat_turns_per_day,
   searches_per_run, max_doc_chars, max_interests, spend_per_day_usd, runs_per_day)
values ('plus', 6, 3, 3, 60, 5, 4000, 30, 0.80, 16)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Spread the default run time over 07:00-07:59 so not every brief is due at once.
-- ---------------------------------------------------------------------------

create function public.default_run_at() returns time
language sql volatile
set search_path = ''
as $$ select '07:00'::time + floor(random() * 60)::int * interval '1 minute' $$;

alter table public.interests alter column run_at set default public.default_run_at();
revoke execute on function public.default_run_at() from public, anon, authenticated;
-- A column default runs as the inserting role.
grant execute on function public.default_run_at() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rolling counts and spend
-- ---------------------------------------------------------------------------

-- Runs of p_user's interests started since p_since (each counts once, retries too).
create function public.user_runs_since(p_user uuid, p_since timestamptz) returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int
  from public.runs r join public.interests i on i.id = r.interest_id
  where i.owner_id = p_user and r.started_at >= p_since
$$;

-- Dollars p_user's runs and chat turns cost since p_since. A started run with
-- no recorded cost counts $0.10.
create function public.user_spend_since(p_user uuid, p_since timestamptz) returns numeric
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce((select sum(coalesce(r.cost_usd, 0.10))
              from public.runs r join public.interests i on i.id = r.interest_id
              where i.owner_id = p_user and r.started_at >= p_since), 0)
  + coalesce((select sum(c.cost_usd) from public.chat_turns c
              where c.user_id = p_user and c.created_at >= p_since), 0)
$$;

-- Whether p_user may start more paid work: a team account, or under the plan's
-- spend over the last 24 hours.
create function public.user_spending_open(p_user uuid, p_now timestamptz default now())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pr.is_team, false)
      or public.user_spend_since(p_user, p_now - interval '24 hours') < pl.spend_per_day_usd
  from (select 1) one
  left join public.profiles pr on pr.id = p_user
  join public.plans pl on pl.id = coalesce(pr.plan, 'free')
$$;

-- The global spend of the last 24 hours (the name is kept for its callers).
create or replace function public.spend_today(p_now timestamptz default now()) returns numeric
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce((select sum(coalesce(cost_usd, 0.10)) from public.runs
              where started_at >= p_now - interval '24 hours'), 0)
  + coalesce((select sum(cost_usd) from public.chat_turns
              where created_at >= p_now - interval '24 hours'), 0)
$$;

-- ---------------------------------------------------------------------------
-- allowance: same keys, rolling 24 hours, public interests counted
-- ---------------------------------------------------------------------------

-- Returns {plan, used, limits}. The *_today keys count the last 24 hours.
-- Deleted interests and following never count.
create or replace function public.allowance(p_user uuid default auth.uid()) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_since timestamptz := now() - interval '24 hours';
begin
  if p_user is null then
    raise exception 'allowance: no user' using errcode = '22004';
  end if;
  if auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'allowance: not your account' using errcode = '42501';
  end if;

  select pl.* into v_plan
  from (select 1) one
  left join public.profiles pr on pr.id = p_user
  join public.plans pl on pl.id = coalesce(pr.plan, 'free');

  return jsonb_build_object(
    'plan', v_plan.id,
    'used', jsonb_build_object(
      'interests', (
        select count(*) from public.interests
        where owner_id = p_user and deleted_at is null),
      'daily_interests', (
        select count(*) from public.interests
        where owner_id = p_user and cadence = 'daily' and deleted_at is null),
      'weekly_interests', (
        select count(*) from public.interests
        where owner_id = p_user and cadence = 'weekly' and deleted_at is null),
      'public_interests', (
        select count(*) from public.interests
        where owner_id = p_user and visibility = 'public' and deleted_at is null),
      'on_demand_runs_today', (
        select count(*) from public.runs
        where requested_by = p_user and created_at >= v_since),
      'chat_turns_today', (
        select count(*) from public.chat_turns
        where user_id = p_user and created_at >= v_since),
      'runs_24h', public.user_runs_since(p_user, v_since),
      'spend_24h_usd', public.user_spend_since(p_user, v_since)
    ),
    'limits', to_jsonb(v_plan) - 'id'
  );
end;
$$;

create or replace function public.check_interest_allowance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_allow jsonb;
  v_same boolean;
  v_live boolean;
  v_live_before boolean;
begin
  -- Serialise quota checks per owner so two inserts cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtext('interest-quota:' || new.owner_id::text));
  v_allow := public.allowance(new.owner_id);

  if tg_op = 'INSERT' or new.doc is distinct from old.doc then
    if char_length(new.doc) > (v_allow -> 'limits' ->> 'max_doc_chars')::int then
      raise exception 'quota: intent doc is longer than % characters',
        v_allow -> 'limits' ->> 'max_doc_chars'
        using errcode = 'P0001', hint = 'max_doc_chars';
    end if;
  end if;

  -- Each cap is checked only when the row starts to count, so lowering a limit
  -- never blocks unrelated edits. allowance() counts the stored rows; this row
  -- is not among them for what it is about to become.
  v_same := tg_op = 'UPDATE' and old.owner_id = new.owner_id;
  v_live := new.deleted_at is null;
  v_live_before := v_same and old.deleted_at is null;

  if v_live and not v_live_before
     and (v_allow -> 'used' ->> 'interests')::int
         >= (v_allow -> 'limits' ->> 'max_interests')::int then
    raise exception 'quota: % of % interests used',
      v_allow -> 'used' ->> 'interests', v_allow -> 'limits' ->> 'max_interests'
      using errcode = 'P0001', hint = 'max_interests';
  end if;

  if v_live and new.cadence in ('daily', 'weekly')
     and not (v_live_before and old.cadence = new.cadence)
     and (v_allow -> 'used' ->> (new.cadence || '_interests'))::int
         >= (v_allow -> 'limits' ->> (new.cadence || '_interests'))::int then
    raise exception 'quota: % of % % interests used',
      v_allow -> 'used' ->> (new.cadence || '_interests'),
      v_allow -> 'limits' ->> (new.cadence || '_interests'),
      new.cadence
      using errcode = 'P0001', hint = new.cadence || '_interests';
  end if;

  if v_live and new.visibility = 'public'
     and not (v_live_before and old.visibility = 'public')
     and not coalesce((select is_team from public.profiles where id = new.owner_id), false)
     and (v_allow -> 'used' ->> 'public_interests')::int
         >= (v_allow -> 'limits' ->> 'max_public_interests')::int then
    raise exception 'quota: % of % public interests used',
      v_allow -> 'used' ->> 'public_interests', v_allow -> 'limits' ->> 'max_public_interests'
      using errcode = 'P0001', hint = 'max_public_interests';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_runs: fair, capped, paused-aware
-- ---------------------------------------------------------------------------

-- In order:
--   1. reap: running runs older than 10 minutes fail an attempt; queued runs of
--      deleted interests fail;
--   2. stop when the kill switch is on or the global 24-hour spend is at the
--      ceiling;
--   3. queue every due scheduled interest that is not paused and has had no
--      scheduled run in the last 20 hours (daily) or 6 days (weekly);
--   4. claim up to p_limit queued runs, oldest first, skipping owners at their
--      runs_per_day or spend cap (team accounts skip both) and rows another
--      tick holds. Each claimed run is marked running.
create or replace function public.claim_runs(p_limit integer, p_now timestamptz default now())
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

  insert into public.runs (interest_id, scheduled_for, created_at)
  select i.id, s.slot, p_now
  from public.interests i
  left join public.profiles pr on pr.id = i.owner_id
  cross join lateral (
    select public.last_run_slot(i.cadence, i.run_at, i.run_weekday,
                                coalesce(pr.timezone, 'UTC'), p_now) as slot
  ) s
  where i.cadence in ('daily', 'weekly') and i.deleted_at is null and not i.paused
    and s.slot >= i.created_at
    and not exists (
      select 1 from public.runs r
      where r.interest_id = i.id and r.requested_by is null
        and r.scheduled_for > s.slot - case i.cadence when 'daily' then interval '20 hours'
                                                      else interval '6 days' end)
  on conflict (interest_id) where status in ('queued', 'running') do nothing;

  return query
  with ranked as (
    select r.id, i.owner_id, r.scheduled_for, r.created_at,
           row_number() over (partition by i.owner_id
                              order by r.scheduled_for, r.created_at) as n
    from public.runs r
    join public.interests i on i.id = r.interest_id
    where r.status = 'queued' and r.scheduled_for <= p_now
  ), eligible as (
    select ranked.id
    from ranked
    left join public.profiles pr on pr.id = ranked.owner_id
    join public.plans pl on pl.id = coalesce(pr.plan, 'free')
    where coalesce(pr.is_team, false)
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
  select c.id, i.topic, i.doc,
         (public.allowance(i.owner_id) -> 'limits' ->> 'searches_per_run')::int
  from claimed c join public.interests i on i.id = c.interest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- request_run: also stops at the owner's spend cap
-- ---------------------------------------------------------------------------

create or replace function public.request_run(p_interest uuid) returns uuid
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
  if not public.user_spending_open(v_user) then
    raise exception 'quota: spend limit of $% reached', v_allow -> 'limits' ->> 'spend_per_day_usd'
      using errcode = 'P0001', hint = 'spend_per_day_usd';
  end if;

  insert into public.runs (interest_id, requested_by) values (p_interest, v_user)
  returning id into v_run;
  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chat: block reasons, the reservation, and the commit
-- ---------------------------------------------------------------------------

create or replace function public.chat_block_reason(p_user uuid) returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_allow jsonb;
begin
  if not public.spending_open() then
    return 'Scout has paused new work for today. Try again tomorrow.';
  end if;
  v_allow := public.allowance(p_user);
  if (v_allow -> 'used' ->> 'chat_turns_today')::int
     >= (v_allow -> 'limits' ->> 'chat_turns_per_day')::int then
    return format('You have used today''s %s chat messages. Try again tomorrow.',
                  v_allow -> 'limits' ->> 'chat_turns_per_day');
  end if;
  if not public.user_spending_open(p_user) then
    return 'You have reached today''s spending limit. Try again tomorrow.';
  end if;
  return null;
end;
$$;

-- Reserve a chat turn before the model call: under the reader's lock, either
-- {"blocked": reason} or a new pending turn {"id": ...} that counts at once.
-- commit_chat_turn completes it.
create function public.begin_chat_turn(p_user uuid, p_message text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('run-request:' || p_user::text));
  v_reason := public.chat_block_reason(p_user);
  if v_reason is not null then
    return jsonb_build_object('blocked', v_reason);
  end if;
  insert into public.chat_turns (user_id, message, status)
  values (p_user, left(p_message, 4000), 'pending')
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- As before, plus: follows only listed public interests, and a turn whose id
-- was reserved by begin_chat_turn completes that pending row.
create or replace function public.commit_chat_turn(
  p_user uuid, p_turn jsonb, p_follows uuid[], p_cost_usd numeric
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_change jsonb;
begin
  for v_change in select * from jsonb_array_elements(coalesce(p_turn -> 'changes', '[]'))
  loop
    case v_change ->> 'op'
      when 'create' then
        insert into public.interests (id, owner_id, topic, doc)
        values ((v_change ->> 'interestId')::uuid, p_user,
                v_change ->> 'topic', coalesce(v_change ->> 'doc', ''));
      when 'update' then
        update public.interests
        set topic = coalesce(v_change ->> 'topic', topic),
            doc = coalesce(v_change ->> 'doc', doc)
        where id = (v_change ->> 'interestId')::uuid and owner_id = p_user
          and deleted_at is null;
      when 'delete' then
        update public.interests set deleted_at = now()
        where id = (v_change ->> 'interestId')::uuid and owner_id = p_user
          and deleted_at is null;
      else
        raise exception 'commit_chat_turn: unknown op %', v_change ->> 'op';
    end case;
  end loop;

  insert into public.follows (user_id, interest_id)
  select p_user, i.id from public.interests i
  where i.id = any(coalesce(p_follows, '{}')) and i.visibility = 'public'
    and public.interest_is_listed(i) and i.owner_id <> p_user
  on conflict do nothing;

  insert into public.chat_turns as t
    (id, user_id, message, reply, changes, pending, status, cost_usd, error_msg, created_at)
  values (
    (p_turn ->> 'id')::uuid, p_user, p_turn ->> 'message', p_turn ->> 'reply',
    nullif(p_turn -> 'changes', 'null'::jsonb), nullif(p_turn -> 'pending', 'null'::jsonb),
    p_turn ->> 'status', greatest(coalesce(p_cost_usd, 0), 0), p_turn ->> 'error_msg',
    coalesce((p_turn ->> 'created_at')::timestamptz, now()))
  on conflict (id) do update
    set message = excluded.message, reply = excluded.reply, changes = excluded.changes,
        pending = excluded.pending, status = excluded.status, cost_usd = excluded.cost_usd,
        error_msg = excluded.error_msg
    where t.user_id = excluded.user_id and t.status = 'pending';
  if not found then
    raise exception 'commit_chat_turn: turn % is not this reader''s pending turn',
      p_turn ->> 'id' using errcode = '23505';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Time zone: once from the browser, then only from Settings
-- ---------------------------------------------------------------------------

alter table public.profiles add column timezone_set boolean not null default false;
revoke update (timezone) on public.profiles from authenticated;

-- Sets the caller's time zone. p_first_time = true (the browser at sign-in)
-- changes nothing once a zone was set. Returns the zone in force.
create function public.set_timezone(p_tz text, p_first_time boolean default false)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'set_timezone: sign in first' using errcode = '42501';
  end if;
  if not public.is_time_zone(p_tz) then
    raise exception 'set_timezone: unknown time zone %', p_tz using errcode = '22023';
  end if;
  update public.profiles
  set timezone = case when p_first_time and timezone_set then timezone else p_tz end,
      timezone_set = true
  where id = auth.uid()
  returning timezone into v_tz;
  return v_tz;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.user_runs_since(uuid, timestamptz),
  public.user_spend_since(uuid, timestamptz), public.user_spending_open(uuid, timestamptz),
  public.begin_chat_turn(uuid, text), public.set_timezone(text, boolean)
  from public, anon, authenticated;
grant execute on function public.begin_chat_turn(uuid, text) to service_role;
grant execute on function public.set_timezone(text, boolean) to authenticated;
