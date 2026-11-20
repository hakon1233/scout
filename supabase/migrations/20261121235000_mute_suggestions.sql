-- "Lots of pushes, mute some?" (plan.md, feed notices). A reader's pushes in
-- the last 7 days are the covered briefs in their topics with the bell on
-- (owned live, or followed and listed), when they have a device. From 10
-- on, mute_suggestions names those topics, least read first
-- (story clicks and brief views in the same 7 days), then most pushes. The
-- feed's card reads it through my_mute_suggestions; the weekly push names the
-- same topics in its payload's 'mute'. Muting is the existing bell
-- (set_topic_push); there is no new setting.

-- {pushes, topics: [{id, title, pushes}]} (up to 3 topics), or null when the
-- reader got fewer than 10 pushes this week.
create function public.mute_suggestions(p_user uuid, p_now timestamptz default now())
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with bell as (
    select i.id, i.topic
    from public.interests i
    where i.owner_id = p_user and i.deleted_at is null and i.push_enabled
    union
    select i.id, i.topic
    from public.follows f
    join public.interests i on i.id = f.interest_id
    where f.user_id = p_user and f.push_enabled and public.interest_is_listed(i)
  ), counted as (
    select b.id, b.topic,
           (select count(*) from public.runs r
            where r.interest_id = b.id and r.status = 'ready'
              and r.coverage ->> 'status' = 'covered'
              and r.finished_at > p_now - interval '7 days'
              and r.finished_at <= p_now)::integer as pushes,
           (select count(*) from public.usage_events u
            where u.user_id = p_user and u.interest_id = b.id
              and u.kind in ('story_click', 'brief_view')
              and u.created_at > p_now - interval '7 days')::integer as reads
    from bell b
  ), total as (
    select coalesce(sum(c.pushes), 0)::integer as n from counted c
  )
  select jsonb_build_object(
           'pushes', t.n,
           'topics', (select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.topic,
                                                          'pushes', q.pushes)
                                       order by q.reads, q.pushes desc, q.topic)
                      from (select * from counted c where c.pushes > 0
                            order by c.reads, c.pushes desc, c.topic limit 3) q))
  from total t
  where t.n >= 10
    and exists (select 1 from public.push_subscriptions s where s.user_id = p_user);
$$;

-- The signed-in reader's own.
create function public.my_mute_suggestions() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select public.mute_suggestions(auth.uid(), now()) where auth.uid() is not null;
$$;

revoke execute on function public.mute_suggestions(uuid, timestamptz),
  public.my_mute_suggestions() from public, anon, authenticated;
grant execute on function public.mute_suggestions(uuid, timestamptz) to service_role;
grant execute on function public.my_mute_suggestions() to authenticated;

-- The weekly push, as in *_picks.sql, plus 'mute': the titles to mute (or []).
create or replace function public.queue_weekly_pushes(
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
           'mute', coalesce((
             select jsonb_agg(m.value -> 'title' order by m.ord)
             from jsonb_array_elements(
                    public.mute_suggestions(rd.user_id, p_now) -> 'topics')
                  with ordinality m(value, ord)), '[]'::jsonb),
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
