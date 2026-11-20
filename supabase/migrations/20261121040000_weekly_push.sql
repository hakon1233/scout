-- The weekly push and per-topic popularity.
--
-- Per-topic pushes are off by default, so most readers hear of new briefs once
-- a week: on Mondays the Worker's daily cleanup cron calls queue_weekly_pushes,
-- which queues one 'weekly' outbox row per device for each reader with a topic
-- (owned or followed, push off) that got a brief with stories in the last 7
-- days. The payload also names up to 3 popular public topics the reader does
-- not have yet; that is the weekly suggestions, folded into the same push.

-- Per-topic aggregates for ranking public topics. One row per live interest.
-- TODO(usage-events): brief_views, story_clicks and seconds_spent are 0 until
-- the usage-events table lands; then sum them from it here, keeping this
-- interface (interest_id, followers, brief_views, story_clicks, seconds_spent).
create view public.topic_popularity
with (security_invoker = true)
as
  select i.id as interest_id,
         (select count(*) from public.follows f where f.interest_id = i.id)::integer as followers,
         0::bigint as brief_views,
         0::bigint as story_clicks,
         0::bigint as seconds_spent
  from public.interests i
  where i.deleted_at is null;

revoke all on public.topic_popularity from public, anon, authenticated;
grant select on public.topic_popularity to service_role;

-- Queues the weekly push. Returns the number of outbox rows queued.
create function public.queue_weekly_pushes(p_now timestamptz default now()) returns integer
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
    union
    select f.user_id, i.id, i.topic
    from public.follows f
    join public.interests i on i.id = f.interest_id
    where not f.push_enabled and public.interest_is_listed(i)
  ), fresh as (
    select m.user_id, m.interest_id, m.topic
    from mine m
    where exists (
      select 1 from public.runs r
      where r.interest_id = m.interest_id and r.status = 'ready'
        and r.coverage ->> 'status' = 'covered'
        and r.finished_at >= p_now - interval '7 days' and r.finished_at <= p_now)
  ), readers as (
    select fr.user_id, count(*)::integer as n,
           (array_agg(fr.topic order by fr.topic))[1:5] as topics
    from fresh fr
    group by fr.user_id
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
  join public.push_subscriptions s on s.user_id = rd.user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.queue_weekly_pushes(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_weekly_pushes(timestamptz) to service_role;
