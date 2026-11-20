-- Browse search and reports (plan/research/browse.md, abuse.md).
--
-- browse_topics searches listed public topics by title and tags (Postgres full
-- text, 'simple' config, prefix match on each word), filters by tags, and sorts
-- by popularity (followers, last 7 days count three times) or newest. No fuzzy
-- matching, no embeddings. tag_counts lists the tags in use.
--
-- report_topic lets a signed-in reader flag a public or link-only topic. One
-- report per reader per topic, 10 per reader per rolling 24 h. Only admins read
-- the reports.

-- ---------------------------------------------------------------------------
-- Search column
-- ---------------------------------------------------------------------------

create function public.topic_search_doc(p_topic text, p_tags text[]) returns tsvector
language sql immutable
set search_path = ''
as $$
  select setweight(to_tsvector('simple'::regconfig, coalesce(p_topic, '')), 'A')
      || setweight(to_tsvector('simple'::regconfig,
                               replace(array_to_string(coalesce(p_tags, '{}'), ' '), '-', ' ')), 'B')
$$;

alter table public.interests
  add column search tsvector generated always as (public.topic_search_doc(topic, tags)) stored;

create index interests_search_idx on public.interests using gin (search);
create index interests_tags_idx on public.interests using gin (tags);

-- "fjord kay" -> 'fjord:* & kay:*'. Words only (letters and digits), at most 8,
-- so the reader's text never reaches to_tsquery's syntax. Null when empty.
create function public.browse_query(p_q text) returns tsquery
language sql immutable
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else to_tsquery('simple'::regconfig, string_agg(w || ':*', ' & ')) end
  from (
    select w from regexp_split_to_table(lower(left(coalesce(p_q, ''), 200)), '[^[:alnum:]æøåÆØÅ]+') w
    where w <> ''
    limit 8) words
$$;

-- ---------------------------------------------------------------------------
-- browse_topics and tag_counts
-- ---------------------------------------------------------------------------

-- Topic cards (topic_card plus followers), at most 50 per page.
--   p_q     words to search in the title and tags, or null for all
--   p_tags  every one of these tags, or null
--   p_sort  'popular' (default) or 'new'
create function public.browse_topics(
  p_q text default null,
  p_tags text[] default null,
  p_sort text default 'popular',
  p_limit integer default 24,
  p_offset integer default 0)
returns setof jsonb
language sql stable security definer
set search_path = ''
as $$
  with q as (select public.browse_query(p_q) as tsq),
  hits as (
    select i, p.followers, p.followers_7d,
           case when q.tsq is null then 0 else ts_rank(i.search, q.tsq) end as rank
    from public.interests i
    cross join q
    join public.topic_popularity p on p.interest_id = i.id
    where i.visibility = 'public' and public.interest_is_listed(i)
      and (q.tsq is null or i.search @@ q.tsq)
      and (coalesce(cardinality(p_tags), 0) = 0 or i.tags @> p_tags)
  )
  select public.topic_card(h.i) || jsonb_build_object('followers', h.followers)
  from hits h
  order by
    case when p_sort = 'new' then coalesce((h.i).published_at, (h.i).created_at) end desc nulls last,
    case when p_q is not null and p_sort is distinct from 'new'
         then h.rank * (1 + ln(1 + h.followers)) end desc nulls last,
    h.followers + 3 * h.followers_7d desc,
    (h.i).id
  limit least(greatest(coalesce(p_limit, 24), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Each tag on a listed public topic, with how many use it, most used first.
create function public.tag_counts()
returns table (tag text, topics integer)
language sql stable security definer
set search_path = ''
as $$
  select t.tag, count(*)::integer
  from public.interests i, unnest(i.tags) as t(tag)
  where i.visibility = 'public' and public.interest_is_listed(i)
  group by t.tag
  order by count(*) desc, t.tag
  limit 200
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create table public.topic_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  interest_id uuid not null references public.interests (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  -- Set by an admin when handled.
  resolved_at timestamptz,
  unique (reporter_id, interest_id)
);

create index topic_reports_open_idx on public.topic_reports (created_at) where resolved_at is null;
create index topic_reports_interest_idx on public.topic_reports (interest_id);

alter table public.topic_reports enable row level security;

create policy topic_reports_admin on public.topic_reports
  for all to authenticated
  using (coalesce((select is_admin from public.profiles where id = auth.uid()), false))
  with check (coalesce((select is_admin from public.profiles where id = auth.uid()), false));

revoke all on public.topic_reports from public, anon, authenticated;
grant select, update (resolved_at) on public.topic_reports to authenticated;

-- A signed-in reader reports a listed (public or shared) topic.
--   42501 signed out; P0002 not listed
--   P0001 hint reports_per_day | already_reported
create function public.report_topic(p_interest uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'report_topic: sign in first' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('report:' || v_uid::text));
  if not exists (select 1 from public.interests i
                 where i.id = p_interest and public.interest_is_listed(i)) then
    raise exception 'report_topic: no such topic' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.topic_reports
             where reporter_id = v_uid and interest_id = p_interest) then
    raise exception 'report_topic: already reported'
      using errcode = 'P0001', hint = 'already_reported';
  end if;
  select count(*) into v_count from public.topic_reports
  where reporter_id = v_uid and created_at > now() - interval '24 hours';
  if v_count >= 10 then
    raise exception 'quota: % of 10 reports used today', v_count
      using errcode = 'P0001', hint = 'reports_per_day';
  end if;
  insert into public.topic_reports (reporter_id, interest_id, reason)
  values (v_uid, p_interest, left(btrim(coalesce(p_reason, '')), 500));
end;
$$;

revoke execute on function public.topic_search_doc(text, text[]), public.browse_query(text),
  public.browse_topics(text, text[], text, integer, integer), public.tag_counts(),
  public.report_topic(uuid, text)
  from public, anon, authenticated;

-- The generated column runs topic_search_doc on every interest write.
grant execute on function public.topic_search_doc(text, text[]) to authenticated, service_role;
grant execute on function public.browse_topics(text, text[], text, integer, integer),
  public.tag_counts()
  to anon, authenticated, service_role;
grant execute on function public.report_topic(uuid, text) to authenticated;
