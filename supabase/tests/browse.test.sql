-- Browse tests: browse_topics search, tag filter and ordering; tag_counts;
-- report_topic; likes and saves; usage events and topic_popularity; the
-- private profile and reserved names; subscriptions. Run with `pnpm test:rls`
-- against `supabase start`, or `pnpm test:rls:hosted`. Rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project has its own catalog; hide it here (rolled back) so only this
-- file's topics count.
update public.interests set hidden_at = now() where visibility = 'public' and hidden_at is null;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'cleo@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'cato@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-0000000000c3', 'cy@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-0000000000c4', 'ada@example.test', 'authenticated', 'authenticated');
update public.profiles set is_admin = true where id = 'dddddddd-0000-0000-0000-0000000000c4';
-- A team account, so the public cap does not get in the way.
update public.profiles set is_team = true where id = 'aaaaaaaa-0000-0000-0000-0000000000c1';

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug, cadence, tags, published_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Fjord kayaking', 'Trips.', 'public', 'd1d1d1d1d1d1d1d1d1d1d1d1', 'off', '{outdoors,travel}', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'AI chips', 'Chips.', 'public', 'd2d2d2d2d2d2d2d2d2d2d2d2', 'off', '{ai,tech}', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000d3', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Kayak racing', 'Races.', 'public', 'd3d3d3d3d3d3d3d3d3d3d3d3', 'off', '{sports}', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000d4', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Kayak secrets', 'Link only.', 'shared', 'd4d4d4d4d4d4d4d4d4d4d4d4', 'off', '{outdoors}', null),
  ('00000000-0000-0000-0000-0000000000d5', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Kayak hidden', 'Hidden.', 'public', 'd5d5d5d5d5d5d5d5d5d5d5d5', 'off', '{outdoors}', now()),
  ('00000000-0000-0000-0000-0000000000d6', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Kayak private', 'Mine.', 'private', null, 'off', '{outdoors}', null);
update public.interests set hidden_at = now() where id = '00000000-0000-0000-0000-0000000000d5';

-- AI chips: 1 old follower. Kayak racing: 2 new ones (3 * 2 + 2 = 8 beats 1).
insert into public.follows (user_id, interest_id, created_at) values
  ('bbbbbbbb-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d2', now() - interval '30 days'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d3', now()),
  ('cccccccc-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d3', now());

-- ---------------------------------------------------------------------------
-- browse_topics and tag_counts, signed out
-- ---------------------------------------------------------------------------

set local role anon;

select results_eq(
  $$select c ->> 'title' from public.browse_topics() c$$,
  array['Kayak racing', 'AI chips', 'Fjord kayaking'],
  'popular: recent follows weigh three times, then all followers');
select results_eq(
  $$select c ->> 'title' from public.browse_topics(p_sort => 'new') c$$,
  array['AI chips', 'Kayak racing', 'Fjord kayaking'],
  'new: latest published first');
select results_eq(
  $$select c ->> 'title' from public.browse_topics('kay') c$$,
  array['Kayak racing', 'Fjord kayaking'],
  'a word prefix matches titles, never link-only, hidden or private topics');
select results_eq(
  $$select c ->> 'title' from public.browse_topics('TRAVEL') c$$,
  array['Fjord kayaking'],
  'tags are searched too, in any case');
select results_eq(
  $$select c ->> 'title' from public.browse_topics(p_tags => array['ai']) c$$,
  array['AI chips'],
  'the tag filter');
select results_eq(
  $$select c ->> 'title' from public.browse_topics('kayak', array['travel']) c$$,
  array['Fjord kayaking'],
  'search and tag filter together');
select is((select count(*)::int from public.browse_topics($$'):*&|!$$)), 3,
  'query syntax is ignored, not parsed');
select is((select count(*)::int from public.browse_topics(p_limit => 1, p_offset => 1)), 1,
  'pages');
select is((select (c ->> 'followers')::int from public.browse_topics('racing') c), 2,
  'cards carry the follower count');
select ok(not exists (select 1 from public.browse_topics() c where c ? 'doc'),
  'the intent doc is never in a card');
select results_eq(
  $$select tag || ':' || topics from public.tag_counts()$$,
  array['ai:1', 'outdoors:1', 'sports:1', 'tech:1', 'travel:1'],
  'tag_counts counts listed public topics only');

reset role;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000c2","role":"authenticated"}', true);

select lives_ok($$select public.report_topic('00000000-0000-0000-0000-0000000000d1', 'Spam')$$,
  'a reader reports a public topic');
select lives_ok($$select public.report_topic('00000000-0000-0000-0000-0000000000d4', 'Nasty')$$,
  'and a link-only one');
select throws_ok($$select public.report_topic('00000000-0000-0000-0000-0000000000d1', 'Again')$$,
  'P0001', null, 'one report per reader per topic');
select throws_ok($$select public.report_topic('00000000-0000-0000-0000-0000000000d6', 'x')$$,
  'P0002', null, 'a private topic cannot be reported');
select is((select count(*)::int from public.topic_reports), 0, 'a reader sees no reports');

select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-0000000000c4","role":"authenticated"}', true);
select is((select count(*)::int from public.topic_reports), 2, 'an admin sees the reports');

reset role;
select set_config('request.jwt.claims', '', true);
insert into public.topic_reports (reporter_id, interest_id, reason, created_at)
select 'cccccccc-0000-0000-0000-0000000000c3', id, 'x', now() - interval '1 hour'
from public.interests where id <> '00000000-0000-0000-0000-0000000000d1' limit 5;
insert into public.interests (owner_id, topic, doc, visibility, share_slug, cadence)
select 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Extra ' || n, 'x', 'shared', 'extra' || n || 'xxxxxxxxxxxxxxxxxxx', 'off'
from generate_series(1, 6) n;
insert into public.topic_reports (reporter_id, interest_id, reason)
select 'cccccccc-0000-0000-0000-0000000000c3', id, 'x'
from public.interests where topic like 'Extra %' and topic <> 'Extra 6';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select throws_ok($$select public.report_topic('00000000-0000-0000-0000-0000000000d1', 'x')$$,
  'P0001', null, 'the 11th report in 24 hours is refused');

reset role;
set local role anon;
select throws_ok($$select public.report_topic('00000000-0000-0000-0000-0000000000d1', 'x')$$,
  '42501', null, 'signed out readers cannot report');
reset role;

-- ---------------------------------------------------------------------------
-- Likes and saves
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000c2","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.story_marks (kind, story_key, story) values
      ('like', 'https://a.test/1', '{"headline":"One"}'), ('save', 'https://a.test/1', '{}')$$,
  'a reader likes and saves a story');
select throws_ok(
  $$insert into public.story_marks (kind, story_key) values ('like', 'https://a.test/1')$$,
  '23505', null, 'a story is liked once');
select lives_ok(
  $$insert into public.story_marks (kind, story_key) values ('like', 'https://a.test/1')
    on conflict (user_id, kind, story_key) do nothing$$,
  'liking again is a no-op the web app can send (upsert, ignore duplicates)');
select is((select count(*)::int from public.story_marks), 2, 'the reader reads their marks');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select is((select count(*)::int from public.story_marks), 0, 'and nobody else does');
select throws_ok(
  $$insert into public.story_marks (user_id, kind, story_key)
    values ('bbbbbbbb-0000-0000-0000-0000000000c2', 'like', 'https://a.test/2')$$,
  '42501', null, 'no one marks for someone else');

-- ---------------------------------------------------------------------------
-- Usage events and popularity
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.usage_events (kind, interest_id, story_key, seconds) values
      ('brief_view', '00000000-0000-0000-0000-0000000000d1', null, null),
      ('story_click', '00000000-0000-0000-0000-0000000000d1', 'https://a.test/1', null),
      ('story_seconds', '00000000-0000-0000-0000-0000000000d1', 'https://a.test/1', 40)$$,
  'a reader sends a batch of events on a public topic');
select throws_ok(
  $$insert into public.usage_events (kind, interest_id) values
      ('brief_view', '00000000-0000-0000-0000-0000000000d6')$$,
  '42501', null, 'not on someone else''s private topic');
select throws_ok(
  $$insert into public.usage_events (kind, interest_id, seconds) values
      ('story_seconds', '00000000-0000-0000-0000-0000000000d1', 4000)$$,
  '23514', null, 'seconds are capped at an hour');
select throws_ok($$select count(*) from public.usage_events$$, '42501', null,
  'readers read no events');
select throws_ok(
  $$insert into public.usage_events (kind, interest_id)
    select 'brief_view', '00000000-0000-0000-0000-0000000000d1' from generate_series(1, 300)$$,
  'P0001', null, 'more than 300 events an hour are refused');

reset role;
select is(
  (select row(brief_views, story_clicks, seconds_spent)::text from public.topic_popularity
   where interest_id = '00000000-0000-0000-0000-0000000000d1'),
  '(1,1,40)', 'topic_popularity sums the events');
update public.usage_events set created_at = now() - interval '31 days';
select public.cleanup_runs();
select is((select count(*)::int from public.usage_events), 0, 'the cleanup drops events after 30 days');

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000c2","role":"authenticated"}', true);

select lives_ok(
  $$update public.profiles set location = 'Oslo', student = true, role = 'Nurse',
      liked_tags = '{health,norway}', display_name = 'Cato'$$,
  'a reader fills in their profile');
select is((select location from public.profiles), 'Oslo', 'and reads it back');
select throws_ok($$update public.profiles set display_name = 'Scout-Team'$$, '23514', null,
  'a dashed Scout team is reserved');
select throws_ok($$update public.profiles set display_name = 'ADMIN.'$$, '23514', null,
  'admin with a dot is reserved');
select throws_ok($$update public.profiles set display_name = 'Sc0ut'$$, '23514', null,
  'a look-alike Scout is reserved');
select lives_ok($$update public.profiles set display_name = 'Scouting for birds'$$,
  'a name that only starts with scout is fine');
select throws_ok($$update public.profiles set liked_tags = '{Not A Tag}'$$, '23514', null,
  'liked tags follow the tag pattern');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles where location is not null), 0,
  'nobody reads another reader''s profile');
select is((select count(*)::int from public.subscriptions), 0, 'subscriptions: own row only');
select throws_ok(
  $$insert into public.subscriptions (user_id, provider, provider_ref, status, plan)
    values ('cccccccc-0000-0000-0000-0000000000c3', 'stripe', 'sub_1', 'active', 'plus')$$,
  '42501', null, 'readers cannot write subscriptions');

reset role;

select * from finish();
rollback;
