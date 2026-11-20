-- Likes, saves and usage events (plan/research/browse.md).
--
-- story_marks: a signed-in reader's liked and saved stories, keyed by the
-- story's canonical url, with the display snapshot the Liked page shows.
-- usage_events: one table, one row per thing a reader did (kind), sent in
-- batches by the web app. Readers insert their own rows and read none; rows
-- older than 30 days go in the daily cleanup. topic_popularity sums them.

-- ---------------------------------------------------------------------------
-- Likes and saves
-- ---------------------------------------------------------------------------

create table public.story_marks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('like', 'save')),
  -- canonicalUrl(url) from @scout/core.
  story_key text not null check (char_length(story_key) between 1 and 2048),
  interest_id uuid references public.interests (id) on delete set null,
  -- What the list shows: {url, headline, blurb?, source, topic, imageUrl?, publishedAt?}.
  story jsonb not null default '{}' check (octet_length(story::text) <= 4096),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, story_key)
);

alter table public.story_marks enable row level security;

create policy story_marks_own on public.story_marks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.story_marks from public, anon, authenticated;
grant select, delete on public.story_marks to authenticated;
grant insert (kind, story_key, interest_id, story) on public.story_marks to authenticated;

-- At most 2000 marks of each kind per reader.
create function public.check_story_marks() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.story_marks
      where user_id = new.user_id and kind = new.kind) >= 2000 then
    raise exception 'quota: 2000 of 2000 %s used', new.kind
      using errcode = 'P0001', hint = 'story_marks';
  end if;
  return new;
end;
$$;

create trigger story_marks_cap
  before insert on public.story_marks
  for each row execute function public.check_story_marks();

-- ---------------------------------------------------------------------------
-- Usage events
-- ---------------------------------------------------------------------------

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- story_click: opened a story at its source. brief_view: opened a brief.
  -- story_seconds: time spent on one story (seconds).
  kind text not null check (kind in ('story_click', 'brief_view', 'story_seconds')),
  interest_id uuid not null references public.interests (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  story_key text check (char_length(story_key) between 1 and 2048),
  seconds integer check (seconds between 0 and 3600),
  created_at timestamptz not null default now(),
  check ((kind = 'story_seconds') = (seconds is not null))
);

create index usage_events_user_idx on public.usage_events (user_id, created_at);
create index usage_events_interest_idx on public.usage_events (interest_id, kind);
create index usage_events_created_idx on public.usage_events (created_at);

alter table public.usage_events enable row level security;

create policy usage_events_own_insert on public.usage_events
  for insert to authenticated
  with check (user_id = auth.uid());

revoke all on public.usage_events from public, anon, authenticated;
grant insert (kind, interest_id, run_id, story_key, seconds) on public.usage_events to authenticated;

-- 300 events per reader per rolling hour; only on topics the reader owns or can
-- see as listed. The server stamps the time.
create function public.check_usage_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  if not exists (
    select 1 from public.interests i
    where i.id = new.interest_id
      and ((i.owner_id = new.user_id and i.deleted_at is null) or public.interest_is_listed(i))) then
    raise exception 'usage_events: no such interest' using errcode = '42501';
  end if;
  if (select count(*) from public.usage_events
      where user_id = new.user_id and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'quota: 300 of 300 events used this hour'
      using errcode = 'P0001', hint = 'usage_events';
  end if;
  return new;
end;
$$;

create trigger usage_events_check
  before insert on public.usage_events
  for each row execute function public.check_usage_event();

-- ---------------------------------------------------------------------------
-- Popularity, now from events (same columns, plus followers_7d)
-- ---------------------------------------------------------------------------

create or replace view public.topic_popularity
with (security_invoker = true)
as
  select i.id as interest_id,
         (select count(*) from public.follows f where f.interest_id = i.id)::integer as followers,
         (select count(*) from public.usage_events e
          where e.interest_id = i.id and e.kind = 'brief_view') as brief_views,
         (select count(*) from public.usage_events e
          where e.interest_id = i.id and e.kind = 'story_click') as story_clicks,
         (select coalesce(sum(e.seconds), 0) from public.usage_events e
          where e.interest_id = i.id and e.kind = 'story_seconds')::bigint as seconds_spent,
         (select count(*) from public.follows f
          where f.interest_id = i.id and f.created_at > now() - interval '7 days')::integer
           as followers_7d
  from public.interests i
  where i.deleted_at is null;

revoke all on public.topic_popularity from public, anon, authenticated;
grant select on public.topic_popularity to service_role;

-- ---------------------------------------------------------------------------
-- Cleanup: events older than 30 days go with the old runs
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_runs(p_now timestamptz default now()) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.runs r
  where r.created_at < p_now - interval '30 days'
    and r.status in ('ready', 'failed')
    and r.id is distinct from (
      select l.id from public.runs l
      where l.interest_id = r.interest_id and l.status = 'ready'
      order by l.finished_at desc nulls last, l.created_at desc
      limit 1);
  get diagnostics v_count = row_count;

  delete from public.outbox where created_at < p_now - interval '1 day';
  delete from public.usage_events where created_at < p_now - interval '30 days';
  return v_count;
end;
$$;

revoke execute on function public.check_story_marks(), public.check_usage_event()
  from public, anon, authenticated;
