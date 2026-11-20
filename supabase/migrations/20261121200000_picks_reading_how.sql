-- Picks may only say "you follow X" of a topic the reader follows: each
-- `reading` row in picks_input now says whether the reader owns it ('own') or
-- follows it ('follow'). Otherwise unchanged from 20261121160000_picks.
-- core picks-prompt.ts reads `how`.

create or replace function public.picks_input(p_user uuid) returns jsonb
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
      select jsonb_agg(jsonb_build_object('title', r.topic, 'tags', to_jsonb(coalesce(r.tags, '{}')),
                                          'how', r.how))
      from (
        select i.topic, i.tags, 'follow' as how from public.follows f
        join public.interests i on i.id = f.interest_id
        where f.user_id = p_user and public.interest_is_listed(i)
        union
        select i.topic, i.tags, 'own' from public.interests i
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
