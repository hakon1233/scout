-- Picks carry the version of the picks prompt that made them. Picks made by an
-- older prompt are stale: my_picks never serves them, and claim_picks makes
-- them again on the next tick (kind 'stale', at most once an hour per reader).
-- Rows whose picks were never made wait for the weekly or profile refresh.
-- Rows from before this migration are version 0, so all of them are stale.
--
-- picks_version() must equal core's PICKS_VERSION (packages/core/src/picks-prompt.ts;
-- packages/worker/test/picks.test.ts checks). Bump both, in a new migration,
-- whenever the picks prompt or its filter changes what a pick may say.
--
-- my_picks_reader() gives the web app what a reason may cite about the reader,
-- so it can drop reasons that no longer hold (an unfollow, a changed profile)
-- when it serves cached picks. Otherwise unchanged from 20261121200000.

alter table public.reader_picks add column version integer not null default 0;

alter table public.pick_runs drop constraint pick_runs_kind_check;
alter table public.pick_runs add constraint pick_runs_kind_check
  check (kind in ('weekly', 'profile', 'stale'));

create function public.picks_version() returns integer
language sql immutable
set search_path = ''
as $$ select 2 $$;

-- Claims up to p_limit readers due a refresh and returns
-- [{user_id, run_id, kind, input}]. Due: the Monday refresh, a profile change
-- (at most once per 24 hours) or stale picks (at most once an hour). Weekly
-- refreshes pending over 12 hours, and those of readers over their spend cap,
-- are sent with the cached picks instead. Nothing is claimed while global
-- spending is closed.
create or replace function public.claim_picks(p_limit integer, p_now timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_row record;
  v_run bigint;
  v_kind text;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.claim_picks')) then
    return v_out;
  end if;

  delete from public.pick_runs where created_at < p_now - interval '30 days';

  perform public.flush_weekly_pick(rp.user_id)
  from public.reader_picks rp
  where rp.weekly_due_at < p_now - interval '12 hours';

  if not public.spending_open(p_now) then
    return v_out;
  end if;

  perform public.flush_weekly_pick(rp.user_id)
  from public.reader_picks rp
  where rp.weekly_due_at is not null
    and not public.user_spending_open(rp.user_id, p_now);

  for v_row in
    select rp.user_id, rp.weekly_due_at, rp.requested_at
    from public.reader_picks rp
    where ((rp.weekly_due_at is not null
            and (rp.attempted_at is null or rp.attempted_at < rp.weekly_due_at))
        or (rp.requested_at is not null
            and (rp.attempted_at is null or rp.attempted_at <= p_now - interval '24 hours'))
        or (rp.made_at is not null and rp.version < public.picks_version()
            and (rp.attempted_at is null or rp.attempted_at <= p_now - interval '1 hour')))
      and public.user_spending_open(rp.user_id, p_now)
    order by coalesce(rp.weekly_due_at, rp.requested_at, rp.attempted_at), rp.user_id
    limit greatest(least(p_limit, 50), 0)
    for update of rp skip locked
  loop
    v_kind := case when v_row.weekly_due_at is not null then 'weekly'
                   when v_row.requested_at is not null then 'profile'
                   else 'stale' end;
    insert into public.pick_runs (user_id, kind, created_at)
    values (v_row.user_id, v_kind, p_now)
    returning id into v_run;
    update public.reader_picks
    set attempted_at = p_now, requested_at = null
    where user_id = v_row.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id', v_row.user_id, 'run_id', v_run, 'kind', v_kind,
      'input', public.picks_input(v_row.user_id)));
  end loop;
  return v_out;
end;
$$;

drop function public.finish_picks(uuid, bigint, jsonb, numeric, text);

-- Records a picks call. p_picks is [{interest_id, reason}] or null when the
-- call failed (the cached picks stay). Only pickable topics are kept, at most
-- 5, reasons cut to 140 characters, stamped with p_version (the caller's
-- PICKS_VERSION; an older caller's picks stay stale). A pending weekly push
-- goes out now. Returns the number of picks stored.
create function public.finish_picks(
  p_user uuid, p_run bigint, p_picks jsonb, p_cost numeric, p_error text default null,
  p_version integer default 0
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_picks jsonb;
  v_n integer := 0;
begin
  update public.pick_runs
  set cost_usd = greatest(coalesce(p_cost, 0), 0), error = left(p_error, 500)
  where id = p_run and user_id = p_user;

  if p_picks is not null and jsonb_typeof(p_picks) = 'array' then
    with given as (
      select (x.value ->> 'interest_id')::uuid as id,
             left(btrim(coalesce(x.value ->> 'reason', '')), 140) as reason,
             x.ord
      from jsonb_array_elements(p_picks) with ordinality x(value, ord)
      where jsonb_typeof(x.value) = 'object'
        and x.value ->> 'interest_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and x.ord <= 50
    ), first_of_each as (
      select distinct on (g.id) g.id, g.reason, g.ord
      from given g
      where public.pickable(p_user, g.id)
      order by g.id, g.ord
    ), kept as (
      select * from first_of_each order by ord limit 5
    )
    select coalesce(jsonb_agg(jsonb_build_object('interest_id', k.id, 'reason', k.reason)
                              order by k.ord), '[]'::jsonb), count(*)
    into v_picks, v_n
    from kept k;

    insert into public.reader_picks (user_id, picks, made_at, version)
    values (p_user, v_picks, now(), coalesce(p_version, 0))
    on conflict (user_id) do update
      set picks = excluded.picks, made_at = excluded.made_at, version = excluded.version;
  end if;

  perform public.flush_weekly_pick(p_user);
  return v_n;
end;
$$;

-- The signed-in reader's current-version picks that are still pickable, best first.
create or replace function public.my_picks()
returns table (id uuid, slug text, title text, tags text[], owner_name text, team boolean,
               reason text)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.share_slug, i.topic, coalesce(i.tags, '{}'),
         case when pr.is_team then 'Scout team' else pr.display_name end,
         coalesce(pr.is_team, false),
         x.value ->> 'reason'
  from public.reader_picks rp
  cross join lateral jsonb_array_elements(rp.picks) with ordinality x(value, ord)
  join public.interests i on i.id = (x.value ->> 'interest_id')::uuid
  left join public.profiles pr on pr.id = i.owner_id
  where rp.user_id = auth.uid()
    and rp.version >= public.picks_version()
    and public.pickable(rp.user_id, i.id)
  order by x.ord
$$;

-- What a pick's reason may cite about the signed-in reader: {profile, reading}
-- as in picks_input. Null when signed out.
create function public.my_picks_reader() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null
              else public.picks_input(auth.uid()) - 'candidates' - 'marks' end
$$;

revoke execute on function public.picks_version(),
  public.finish_picks(uuid, bigint, jsonb, numeric, text, integer),
  public.my_picks_reader()
  from public, anon, authenticated;
grant execute on function public.finish_picks(uuid, bigint, jsonb, numeric, text, integer)
  to service_role;
grant execute on function public.my_picks_reader() to authenticated;
