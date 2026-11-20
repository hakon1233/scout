-- Picks: up to 5 public topics picked for each reader, with a one-line reason.
--
-- One cached ranking per reader (reader_picks). The Worker refreshes it with
-- one Haiku call per reader, from claim_picks' input (profile, likes and saves,
-- followed topics' tags, about 40 candidates scored by tag overlap and
-- topic_popularity), and stores the answer with finish_picks.
--
-- A refresh is due in two cases:
--   * Weekly: on Mondays the daily cron calls start_weekly_picks, which marks
--     readers active in the last 30 days. Their weekly push waits for the new
--     picks (finish_picks queues it), or goes out with the cached picks after
--     12 hours, or at once when the reader is over their spend cap.
--   * Profile change: the profiles trigger sets requested_at. claim_picks takes
--     it at most once per 24 hours per reader, never inline in the request.
-- Each call is a pick_runs row that counts against the reader's and the global
-- spend caps ($0.01 until its cost is recorded).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.reader_picks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- [{interest_id, reason}], best first, at most 5.
  picks jsonb not null default '[]' check (jsonb_typeof(picks) = 'array'),
  made_at timestamptz,
  -- A profile change asked for a refresh.
  requested_at timestamptz,
  -- The last claim; a profile refresh waits 24 hours after it.
  attempted_at timestamptz,
  -- The Monday refresh is pending; the weekly push waits for it.
  weekly_due_at timestamptz
);

create index reader_picks_due_idx on public.reader_picks (weekly_due_at, requested_at)
  where weekly_due_at is not null or requested_at is not null;

alter table public.reader_picks enable row level security;
create policy reader_picks_own on public.reader_picks
  for select to authenticated using (user_id = auth.uid());
revoke all on public.reader_picks from public, anon, authenticated;
grant select on public.reader_picks to authenticated;

create table public.dismissed_picks (
  user_id uuid not null references auth.users (id) on delete cascade,
  interest_id uuid not null references public.interests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, interest_id)
);

alter table public.dismissed_picks enable row level security;
create policy dismissed_picks_own on public.dismissed_picks
  for select to authenticated using (user_id = auth.uid());
revoke all on public.dismissed_picks from public, anon, authenticated;
grant select on public.dismissed_picks to authenticated;

-- One row per picks call, for the spend caps. Kept 30 days.
create table public.pick_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('weekly', 'profile')),
  cost_usd numeric,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now()
);

create index pick_runs_user_idx on public.pick_runs (user_id, created_at);
create index pick_runs_created_idx on public.pick_runs (created_at);

alter table public.pick_runs enable row level security;
revoke all on public.pick_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spend: picks calls count against both caps
-- ---------------------------------------------------------------------------

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
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether p_interest may be picked for p_user: public, listed, not theirs, not
-- followed, not dismissed.
create function public.pickable(p_user uuid, p_interest uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.interests i
    where i.id = p_interest and i.visibility = 'public' and public.interest_is_listed(i)
      and i.owner_id <> p_user
      and not exists (select 1 from public.follows f
                      where f.user_id = p_user and f.interest_id = i.id)
      and not exists (select 1 from public.dismissed_picks d
                      where d.user_id = p_user and d.interest_id = i.id))
$$;

-- What the picks prompt reads for one reader: {profile, reading, marks, candidates}.
create function public.picks_input(p_user uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with reader_tags as (
    select distinct t
    from (
      select unnest(pr.liked_tags) as t from public.profiles pr where pr.id = p_user
      union all
      select unnest(coalesce(i.tags, '{}'))
      from public.follows f join public.interests i on i.id = f.interest_id
      where f.user_id = p_user
    ) x
  ), scored as (
    select i.id, i.topic, i.tags, i.doc,
           2 * (select count(*) from unnest(coalesce(i.tags, '{}')) t
                where t in (select rt.t from reader_tags rt))
           + ln(1 + coalesce(p.followers, 0) + 3 * coalesce(p.followers_7d, 0)) as score
    from public.interests i
    left join public.topic_popularity p on p.interest_id = i.id
    where i.visibility = 'public' and public.interest_is_listed(i)
      and i.owner_id <> p_user
      and not exists (select 1 from public.follows f
                      where f.user_id = p_user and f.interest_id = i.id)
      and not exists (select 1 from public.dismissed_picks d
                      where d.user_id = p_user and d.interest_id = i.id)
  )
  select jsonb_build_object(
    'profile', coalesce((
      select jsonb_strip_nulls(jsonb_build_object(
        'location', pr.location, 'student', pr.student, 'role', pr.role,
        'likedTags', to_jsonb(pr.liked_tags)))
      from public.profiles pr where pr.id = p_user), '{}'::jsonb),
    'reading', coalesce((
      select jsonb_agg(jsonb_build_object('title', r.topic, 'tags', to_jsonb(coalesce(r.tags, '{}'))))
      from (
        select i.topic, i.tags from public.follows f
        join public.interests i on i.id = f.interest_id
        where f.user_id = p_user and public.interest_is_listed(i)
        union
        select i.topic, i.tags from public.interests i
        where i.owner_id = p_user and i.deleted_at is null
        limit 30) r), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object('kind', m.kind, 'headline', m.story ->> 'headline',
                                          'topic', m.story ->> 'topic'))
      from (
        select sm.kind, sm.story from public.story_marks sm
        where sm.user_id = p_user
        order by sm.created_at desc
        limit 10) m), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.topic,
                                          'tags', to_jsonb(coalesce(s.tags, '{}')),
                                          'about', left(s.doc, 200))
                       order by s.score desc, s.id)
      from (select * from scored order by score desc, id limit 40) s), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- The weekly push, now with picks
-- ---------------------------------------------------------------------------

drop function public.queue_weekly_pushes(timestamptz);

-- Queues the weekly push: one 'weekly' outbox row per device for each reader
-- with a fresh brief in a push-off topic, or with picks. With p_user, only that
-- reader; without, every reader whose Monday picks refresh is not pending.
-- Returns the number of outbox rows queued.
create function public.queue_weekly_pushes(
  p_now timestamptz default now(), p_user uuid default null
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with mine as (
    -- Each reader's topics with push off: owned (live) and followed (listed).
    select i.owner_id as user_id, i.id as interest_id, i.topic
    from public.interests i
    where i.deleted_at is null and not i.push_enabled
      and (p_user is null or i.owner_id = p_user)
    union
    select f.user_id, i.id, i.topic
    from public.follows f
    join public.interests i on i.id = f.interest_id
    where not f.push_enabled and public.interest_is_listed(i)
      and (p_user is null or f.user_id = p_user)
  ), fresh as (
    select m.user_id, m.interest_id, m.topic
    from mine m
    where exists (
      select 1 from public.runs r
      where r.interest_id = m.interest_id and r.status = 'ready'
        and r.coverage ->> 'status' = 'covered'
        and r.finished_at >= p_now - interval '7 days' and r.finished_at <= p_now)
  ), briefs as (
    select fr.user_id, count(*)::integer as n,
           (array_agg(fr.topic order by fr.topic))[1:5] as topics
    from fresh fr
    group by fr.user_id
  ), picked as (
    -- Up to 3 cached picks that are still pickable.
    select rp.user_id, jsonb_agg(jsonb_build_object('title', i.topic, 'slug', i.share_slug)
                                 order by e.ord) as picks
    from public.reader_picks rp
    cross join lateral (
      select x.value, x.ord
      from jsonb_array_elements(rp.picks) with ordinality x(value, ord)
      where public.pickable(rp.user_id, (x.value ->> 'interest_id')::uuid)
      order by x.ord
      limit 3) e
    join public.interests i on i.id = (e.value ->> 'interest_id')::uuid
    where p_user is null or rp.user_id = p_user
    group by rp.user_id
  ), readers as (
    select coalesce(b.user_id, pk.user_id) as user_id,
           coalesce(b.n, 0) as n,
           coalesce(b.topics, '{}') as topics,
           coalesce(pk.picks, '[]'::jsonb) as picks
    from briefs b
    full join picked pk on pk.user_id = b.user_id
  ), popular as (
    select i.id, i.topic, i.share_slug, p.followers, p.brief_views, p.story_clicks, p.seconds_spent
    from public.interests i
    join public.topic_popularity p on p.interest_id = i.id
    where i.visibility = 'public' and public.interest_is_listed(i)
  )
  insert into public.outbox (kind, user_id, subscription_id, payload)
  select 'weekly', rd.user_id, s.id,
         jsonb_build_object(
           'count', rd.n,
           'topics', to_jsonb(rd.topics),
           'picks', rd.picks,
           'popular', coalesce((
             select jsonb_agg(jsonb_build_object('title', q.topic, 'slug', q.share_slug))
             from (
               select pp.topic, pp.share_slug from popular pp
               where not exists (select 1 from public.interests o
                                 where o.id = pp.id and o.owner_id = rd.user_id)
                 and not exists (select 1 from public.follows f
                                 where f.interest_id = pp.id and f.user_id = rd.user_id)
               order by pp.followers desc, pp.brief_views desc, pp.story_clicks desc,
                        pp.seconds_spent desc, pp.id
               limit 3) q), '[]'::jsonb))
  from readers rd
  join public.push_subscriptions s on s.user_id = rd.user_id
  where p_user is not null
     or not exists (select 1 from public.reader_picks w
                    where w.user_id = rd.user_id and w.weekly_due_at is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh requests
-- ---------------------------------------------------------------------------

-- A profile change asks for a refresh. claim_picks debounces it.
create function public.request_picks_on_profile() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.reader_picks (user_id, requested_at)
  values (new.id, now())
  on conflict (user_id) do update
    set requested_at = coalesce(public.reader_picks.requested_at, excluded.requested_at);
  return null;
end;
$$;

create trigger profiles_request_picks
  after update of location, student, role, liked_tags on public.profiles
  for each row
  when (old.location is distinct from new.location
     or old.student is distinct from new.student
     or old.role is distinct from new.role
     or old.liked_tags is distinct from new.liked_tags)
  execute function public.request_picks_on_profile();

-- Monday: marks readers active in the last 30 days for a weekly refresh.
-- Returns how many.
create function public.start_weekly_picks(p_now timestamptz default now()) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.reader_picks (user_id, weekly_due_at)
  select u.id, p_now
  from auth.users u
  where exists (select 1 from public.usage_events e
                where e.user_id = u.id and e.created_at >= p_now - interval '30 days')
     or exists (select 1 from public.story_marks m
                where m.user_id = u.id and m.created_at >= p_now - interval '30 days')
     or exists (select 1 from public.follows f
                where f.user_id = u.id and f.created_at >= p_now - interval '30 days')
  on conflict (user_id) do update set weekly_due_at = excluded.weekly_due_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Sends a pending weekly push with whatever picks are cached and clears it.
create function public.flush_weekly_pick(p_user uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_due timestamptz;
begin
  select weekly_due_at into v_due from public.reader_picks
  where user_id = p_user for update;
  if v_due is null then
    return 0;
  end if;
  update public.reader_picks set weekly_due_at = null where user_id = p_user;
  return public.queue_weekly_pushes(v_due, p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- The Worker's side
-- ---------------------------------------------------------------------------

-- Claims up to p_limit readers due a refresh and returns
-- [{user_id, run_id, kind, input}]. Weekly refreshes pending over 12 hours, and
-- those of readers over their spend cap, are sent with the cached picks
-- instead. Nothing is claimed while global spending is closed.
create function public.claim_picks(p_limit integer, p_now timestamptz default now())
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
    select rp.user_id, rp.weekly_due_at
    from public.reader_picks rp
    where ((rp.weekly_due_at is not null
            and (rp.attempted_at is null or rp.attempted_at < rp.weekly_due_at))
        or (rp.requested_at is not null
            and (rp.attempted_at is null or rp.attempted_at <= p_now - interval '24 hours')))
      and public.user_spending_open(rp.user_id, p_now)
    order by coalesce(rp.weekly_due_at, rp.requested_at), rp.user_id
    limit greatest(least(p_limit, 50), 0)
    for update of rp skip locked
  loop
    v_kind := case when v_row.weekly_due_at is not null then 'weekly' else 'profile' end;
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

-- Records a picks call. p_picks is [{interest_id, reason}] or null when the
-- call failed (the cached picks stay). Only pickable topics are kept, at most
-- 5, reasons cut to 140 characters. A pending weekly push goes out now.
-- Returns the number of picks stored.
create function public.finish_picks(
  p_user uuid, p_run bigint, p_picks jsonb, p_cost numeric, p_error text default null
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

    insert into public.reader_picks (user_id, picks, made_at)
    values (p_user, v_picks, now())
    on conflict (user_id) do update set picks = excluded.picks, made_at = excluded.made_at;
  end if;

  perform public.flush_weekly_pick(p_user);
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The reader's side
-- ---------------------------------------------------------------------------

-- The signed-in reader's picks that are still pickable, best first.
create function public.my_picks()
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
    and public.pickable(rp.user_id, i.id)
  order by x.ord
$$;

-- Hides a pick for good. Idempotent; keeps the newest 1000 per reader.
create function public.dismiss_pick(p_interest uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'dismiss_pick: sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.interests where id = p_interest) then
    return;
  end if;
  insert into public.dismissed_picks (user_id, interest_id) values (v_user, p_interest)
  on conflict do nothing;
  delete from public.dismissed_picks d
  where d.user_id = v_user
    and d.interest_id in (
      select o.interest_id from public.dismissed_picks o
      where o.user_id = v_user
      order by o.created_at desc, o.interest_id
      offset 1000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.pickable(uuid, uuid), public.picks_input(uuid),
  public.queue_weekly_pushes(timestamptz, uuid), public.request_picks_on_profile(),
  public.start_weekly_picks(timestamptz), public.flush_weekly_pick(uuid),
  public.claim_picks(integer, timestamptz),
  public.finish_picks(uuid, bigint, jsonb, numeric, text),
  public.my_picks(), public.dismiss_pick(uuid)
  from public, anon, authenticated;
grant execute on function public.queue_weekly_pushes(timestamptz, uuid),
  public.start_weekly_picks(timestamptz), public.claim_picks(integer, timestamptz),
  public.finish_picks(uuid, bigint, jsonb, numeric, text)
  to service_role;
grant execute on function public.my_picks(), public.dismiss_pick(uuid) to authenticated;
