-- Listing tests: hide_interest, and that a hidden interest drops out of every
-- path that uses interest_is_listed (link, follow, catalog, follower reads of
-- the interest and its runs, push targets, chat follows, weekly suggestions),
-- while its owner keeps it. Also the stopped notice and unpublish-on-edit.
-- Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project has its own catalog; hide it here (rolled back) so only this
-- file's topics count.
update public.interests set hidden_at = now() where visibility = 'public' and hidden_at is null;

-- ---------------------------------------------------------------------------
-- Setup (as postgres): Hana publishes, Ben follows, Ada is an admin.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'hana@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'ben@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-00000000000d', 'ada@example.test', 'authenticated', 'authenticated');
update public.profiles set is_admin = true where id = 'dddddddd-0000-0000-0000-00000000000d';
update public.profiles set display_name = 'Hana H' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug, cadence, tags) values
  ('00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'Fjord kayaking', 'Trips and gear.', 'public', 'fjordfjordfjordfjordfjord', 'weekly', '{outdoors}'),
  ('00000000-0000-0000-0000-00000000a002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'Ski touring', 'Avalanche reports.', 'public', 'skiskiskiskiskiskiskiski', 'weekly', '{outdoors}');
insert into public.follows (user_id, interest_id, push_enabled) values
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a001', true),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a002', false);
update public.interests set push_enabled = true where id = '00000000-0000-0000-0000-00000000a001';

insert into public.runs (id, interest_id, status, section_md, coverage, finished_at) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000a001',
   'ready', '## Fjord kayaking', '{"status":"covered"}', now());
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/hana', 'p', 'a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/ben', 'p', 'a');

-- ---------------------------------------------------------------------------
-- Before: a public topic card
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select c ->> 'owner_name' from public.public_topics('outdoors') c
    where c ->> 'id' = '00000000-0000-0000-0000-00000000a001'), 'Hana H',
  'a topic card shows the owner''s display name');
select is((select count(*)::int from public.public_topics('no-such-tag') c
    where c ->> 'id' like '00000000-%'), 0, 'public_topics filters by tag');
reset role;

-- ---------------------------------------------------------------------------
-- Hiding: admins and the service role only
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select public.hide_interest('00000000-0000-0000-0000-00000000a001', 'spam') $$,
  '42501', null, 'a reader who is not an admin cannot hide');
select throws_ok($$ update public.interests set hidden_at = now() $$, '42501', null,
  'hidden_at has no column grant');

select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select lives_ok($$ select public.hide_interest('00000000-0000-0000-0000-00000000a001',
    'Links to a scam shop.') $$, 'an admin hides an interest with a reason');
select throws_ok($$ select public.hide_interest('00000000-0000-0000-0000-0000000fffff', 'x') $$,
  'P0002', null, 'hiding an unknown interest fails');
reset role;

select is((select hidden_reason from public.interests where id = '00000000-0000-0000-0000-00000000a001'),
  'Links to a scam shop.', 'the reason is kept');
select results_eq($$ select user_id::text || ' ' || kind || ' ' || coalesce(payload ->> 'reason', '-')
    || ' ' || (payload ? 'doc')::text
    from public.notifications where payload ->> 'interest_id' = '00000000-0000-0000-0000-00000000a001'
    order by 1 $$,
  array['aaaaaaaa-0000-0000-0000-00000000000a hidden Links to a scam shop. false',
        'bbbbbbbb-0000-0000-0000-00000000000b hidden - false'],
  'the owner is told why; the follower is told, with no doc to copy');
select is((select count(*)::int from public.follows
    where interest_id = '00000000-0000-0000-0000-00000000a001'), 0, 'the follows end');

-- A follow row left behind (or planted) still shows nothing: the predicate holds.
insert into public.follows (user_id, interest_id, push_enabled) values
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a001', true);

-- ---------------------------------------------------------------------------
-- Every listed path drops the hidden interest
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.interest_by_slug('fjordfjordfjordfjordfjord'), null, '1. its link shows nothing');
select results_eq($$ select c ->> 'title' from public.public_topics() c
    where c ->> 'id' like '00000000-%' $$, array['Ski touring'], '2. the catalog drops it');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select public.follow('fjordfjordfjordfjordfjord') $$, 'P0002', null,
  '3. it cannot be followed');
select results_eq($$ select topic from public.interests where id::text like '00000000-%' order by 1 $$,
  array['Ski touring'], '4. a follower no longer reads it');
select is((select count(*)::int from public.runs
    where interest_id = '00000000-0000-0000-0000-00000000a001'), 0, '5. nor its runs');
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select user_id::text from public.push_targets('00000000-0000-0000-0000-0000000f0001') $$,
  array['aaaaaaaa-0000-0000-0000-00000000000a'], '6. pushes go to its owner, not its followers');
select lives_ok($$ select public.commit_chat_turn('bbbbbbbb-0000-0000-0000-00000000000b',
    '{"id":"00000000-0000-0000-0000-0000000c0001","message":"follow it","reply":"ok","status":"ready"}'::jsonb,
    array['00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002']::uuid[], 0) $$,
  'the chat asks to follow both');
reset role;
select results_eq($$ select interest_id::text || ' ' || user_id::text from public.follows
    where interest_id = '00000000-0000-0000-0000-00000000a002' $$,
  array['00000000-0000-0000-0000-00000000a002 bbbbbbbb-0000-0000-0000-00000000000b'],
  '7. a chat follow of the listed one stands');
delete from public.follows where interest_id = '00000000-0000-0000-0000-00000000a001';
set local role service_role;
select public.commit_chat_turn('bbbbbbbb-0000-0000-0000-00000000000b',
  '{"id":"00000000-0000-0000-0000-0000000c0002","message":"again","reply":"ok","status":"ready"}'::jsonb,
  array['00000000-0000-0000-0000-00000000a001']::uuid[], 0);
reset role;
select is((select count(*)::int from public.follows
    where interest_id = '00000000-0000-0000-0000-00000000a001'), 0,
  '7. the chat cannot follow the hidden one');

-- 8. The weekly suggestions skip it: Ben's push-off topic Ski touring gets a
-- brief, and the only other public topic is the hidden one.
insert into public.runs (interest_id, status, section_md, coverage, finished_at) values
  ('00000000-0000-0000-0000-00000000a002', 'ready', '## Ski', '{"status":"covered"}', now());
delete from public.follows where interest_id = '00000000-0000-0000-0000-00000000a002'
  and user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
set local role service_role;
select public.queue_weekly_pushes(now());
reset role;
select is((select payload -> 'popular' from public.outbox
    where kind = 'weekly' and user_id = 'bbbbbbbb-0000-0000-0000-00000000000b'), '[]'::jsonb,
  '8. weekly suggestions never name a hidden topic');

-- The owner keeps it.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select hidden_reason from public.interests where id = '00000000-0000-0000-0000-00000000a001'),
  'Links to a scam shop.', 'the owner still reads a hidden interest, with the reason');
select is((select count(*)::int from public.runs
    where interest_id = '00000000-0000-0000-0000-00000000a001'), 1, 'and its runs');
select throws_ok($$ select public.set_sharing('00000000-0000-0000-0000-00000000a001', 'shared') $$,
  'P0002', null, 'a hidden interest cannot be shared again');
reset role;

-- ---------------------------------------------------------------------------
-- Stopped: still listed, but no longer running
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
update public.interests set paused = true where id = '00000000-0000-0000-0000-00000000a002';
reset role;
select results_eq($$ select kind || ' ' || (payload ->> 'cadence') from public.notifications
    where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
      and payload ->> 'interest_id' = '00000000-0000-0000-0000-00000000a002' $$,
  array['stopped weekly'], 'pausing a listed interest tells its followers it stopped');
select is((select count(*)::int from public.follows
    where interest_id = '00000000-0000-0000-0000-00000000a002'), 1, 'they keep following');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('scout.copy', public.host_copy(
  (select id from public.notifications where kind = 'stopped'))::text, true);
select results_eq($$ select cadence from public.interests
    where id = current_setting('scout.copy')::uuid $$,
  array['off'], 'a follower copies a stopped interest, switched off');
reset role;

-- ---------------------------------------------------------------------------
-- Editing a public interest takes it back to shared
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
update public.interests set paused = false, visibility = 'public'
where id = '00000000-0000-0000-0000-00000000a002';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
update public.interests set run_at = '09:00' where id = '00000000-0000-0000-0000-00000000a002';
select is((select visibility from public.interests where id = '00000000-0000-0000-0000-00000000a002'),
  'public', 'a new run time keeps it public');
update public.interests set doc = 'Avalanche reports and huts.'
where id = '00000000-0000-0000-0000-00000000a002';
select is((select visibility from public.interests where id = '00000000-0000-0000-0000-00000000a002'),
  'shared', 'a new intent doc takes it back to shared until it is checked again');
reset role;
select is((select count(*)::int from public.follows
    where interest_id = '00000000-0000-0000-0000-00000000a002'), 1,
  'followers keep a topic that went from public to shared');

select ok(not has_function_privilege('anon', 'public.hide_interest(uuid, text)', 'execute'),
  'signed out, nothing is hidden');

select * from finish();
rollback;
