-- Usage tests (20261121110000_usage.sql): the 2000-mark cap per kind
-- (check_story_marks), check_usage_event's stamp, topic check and rolling hour,
-- and the cleanup keeping events younger than 30 days. browse.test.sql covers
-- the happy paths. Run with `pnpm test:sql usage`. Rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project has its own readers' events; drop them here (rolled back)
-- so only this file's events count.
delete from public.usage_events;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'una@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', 'ivo@example.test', 'authenticated', 'authenticated');

insert into public.interests (id, owner_id, topic, doc, visibility, cadence) values
  ('00000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Una private', 'Mine.', 'private', 'off'),
  ('00000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Una deleted', 'Gone.', 'private', 'off');
update public.interests set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000f2';

-- ---------------------------------------------------------------------------
-- Likes and saves: 2000 of each kind
-- ---------------------------------------------------------------------------

insert into public.story_marks (user_id, kind, story_key)
select 'aaaaaaaa-0000-0000-0000-0000000000e1', 'like', 'https://a.test/' || n
from generate_series(1, 1999) n;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.story_marks (kind, story_key) values ('like', 'https://a.test/2000')$$,
  'the 2000th like lands');
select throws_ok(
  $$insert into public.story_marks (kind, story_key) values ('like', 'https://a.test/2001')$$,
  'P0001', null, 'the 2001st like is refused');
select lives_ok(
  $$insert into public.story_marks (kind, story_key) values ('save', 'https://a.test/2001')$$,
  'saves have their own 2000');
select lives_ok(
  $$delete from public.story_marks where kind = 'like' and story_key = 'https://a.test/1'$$,
  'an unlike frees a place');
select lives_ok(
  $$insert into public.story_marks (kind, story_key) values ('like', 'https://a.test/2001')$$,
  'and the next like lands');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.story_marks (kind, story_key) values ('like', 'https://a.test/2001')$$,
  'the cap is per reader');

-- ---------------------------------------------------------------------------
-- Usage events
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.usage_events (kind, interest_id) values
      ('brief_view', '00000000-0000-0000-0000-0000000000f1')$$,
  'an owner sends events on their own private topic');
select throws_ok(
  $$insert into public.usage_events (kind, interest_id) values
      ('brief_view', '00000000-0000-0000-0000-0000000000f2')$$,
  '42501', null, 'not on a deleted topic');
select throws_ok(
  $$insert into public.usage_events (kind, interest_id, created_at) values
      ('brief_view', '00000000-0000-0000-0000-0000000000f1', now() - interval '2 days')$$,
  '42501', null, 'a reader cannot set the time');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.usage_events (kind, interest_id) values
      ('brief_view', '00000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'nor on someone else''s private topic');

reset role;
select set_config('request.jwt.claims', '', true);

insert into public.usage_events (user_id, kind, interest_id, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'brief_view', '00000000-0000-0000-0000-0000000000f1',
   now() - interval '5 days');
select is(
  (select count(*)::int from public.usage_events where created_at < now() - interval '1 hour'), 0,
  'the server stamps the time, even for the service role');

-- The rule applies to every writer. Events from two hours ago no longer
-- count: 300 old ones, then 299 this hour.
update public.usage_events set created_at = now() - interval '2 hours';
insert into public.usage_events (user_id, kind, interest_id)
select 'aaaaaaaa-0000-0000-0000-0000000000e1', 'story_click', '00000000-0000-0000-0000-0000000000f1'
from generate_series(1, 298) n;
update public.usage_events set created_at = now() - interval '2 hours';
insert into public.usage_events (user_id, kind, interest_id)
select 'aaaaaaaa-0000-0000-0000-0000000000e1', 'brief_view', '00000000-0000-0000-0000-0000000000f1'
from generate_series(1, 299) n;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is((select count(*)::int from public.story_marks where kind = 'like'), 2000,
  'still 2000 likes');
select lives_ok(
  $$insert into public.usage_events (kind, interest_id) values
      ('brief_view', '00000000-0000-0000-0000-0000000000f1')$$,
  'the 300th event this hour lands; older ones do not count');
select throws_ok(
  $$insert into public.usage_events (kind, interest_id) values
      ('brief_view', '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001', null, 'the 301st is refused');

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------

update public.usage_events set created_at = now() - interval '29 days' where kind = 'story_click';
update public.usage_events set created_at = now() - interval '31 days' where kind = 'brief_view';
select is((select count(*)::int from public.usage_events where kind = 'story_click'), 298,
  '298 story clicks are 29 days old');
select public.cleanup_runs();
select is((select count(*)::int from public.usage_events), 298,
  'the cleanup keeps events younger than 30 days and drops the rest');

select * from finish();
rollback;
