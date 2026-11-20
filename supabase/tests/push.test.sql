-- Push subscription tests: a reader saves, sees and deletes only their own
-- devices; a device that changes hands moves to its new reader; push_targets
-- gives the Worker the owner's and followers' devices for a ready run only.
-- Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Setup (as postgres): Hana hosts a shared interest, Ben follows it, Cleo does not.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'hana@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'ben@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'cleo@example.test', 'authenticated', 'authenticated');

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug) values
  ('00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'Trondheim events', '', 'shared', 'trondheimtrondheimtrondheim');
insert into public.follows (user_id, interest_id) values
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a001');

insert into public.runs (id, interest_id, status, section_md, finished_at) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000a001',
   'ready', '## Trondheim events', now());
insert into public.runs (id, interest_id, status) values
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000a001', 'running');

-- ---------------------------------------------------------------------------
-- A reader's own devices
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ select public.save_push_subscription(
    'https://fcm.googleapis.com/fcm/send/hana-phone', 'p256-hana', 'auth-hana') $$,
  'a reader saves a device');
select lives_ok($$ select public.save_push_subscription(
    'https://fcm.googleapis.com/fcm/send/hana-phone', 'p256-hana-2', 'auth-hana-2') $$,
  'saving the same device again updates it');
select results_eq($$ select p256dh from public.push_subscriptions $$,
  array['p256-hana-2'], 'one row per device, with the newest keys');

select throws_ok($$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/fake', 'x', 'y') $$,
  '42501', null, 'no one adds a device for someone else');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select lives_ok($$ select public.save_push_subscription(
    'https://fcm.googleapis.com/fcm/send/ben-laptop', 'p256-ben', 'auth-ben') $$,
  'another reader saves their own device');
select results_eq($$ select endpoint from public.push_subscriptions $$,
  array['https://fcm.googleapis.com/fcm/send/ben-laptop'], 'a reader sees only their own devices');

delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/hana-phone';
reset role;
select is((select count(*)::int from public.push_subscriptions
    where endpoint = 'https://fcm.googleapis.com/fcm/send/hana-phone'), 1,
  'no one deletes someone else''s device');

-- Cleo signs in on Hana's phone: the device is hers now.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select lives_ok($$ select public.save_push_subscription(
    'https://fcm.googleapis.com/fcm/send/hana-phone', 'p256-cleo', 'auth-cleo') $$,
  'a device that changes hands is saved for its new reader');
reset role;
select results_eq($$ select user_id::text from public.push_subscriptions
    where endpoint = 'https://fcm.googleapis.com/fcm/send/hana-phone' $$,
  array['cccccccc-0000-0000-0000-00000000000c'], 'and stops notifying its old reader');

set local role authenticated;
select lives_ok($$ delete from public.push_subscriptions
    where endpoint = 'https://fcm.googleapis.com/fcm/send/hana-phone' $$, 'a reader deletes their own device');
reset role;
select is((select count(*)::int from public.push_subscriptions
    where endpoint = 'https://fcm.googleapis.com/fcm/send/hana-phone'), 0, 'it is gone');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.push_subscriptions $$,
  '42501', null, 'signed out, nothing is read');

-- ---------------------------------------------------------------------------
-- push_targets: the Worker's list for a ready run. Per-topic push is off by
-- default; each reader turns it on for a topic they own or follow.
-- ---------------------------------------------------------------------------

reset role;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/hana-phone', 'p-h', 'a-h'),
  ('cccccccc-0000-0000-0000-00000000000c', 'https://fcm.googleapis.com/fcm/send/cleo-phone', 'p-c', 'a-c');

set local role service_role;
select is((select count(*)::int from public.push_targets('00000000-0000-0000-0000-0000000f0001')), 0,
  'with every topic switch off by default, a ready run notifies no one');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.set_topic_push('00000000-0000-0000-0000-00000000a001', true), true,
  'the owner turns on pushes for their topic');
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is(public.set_topic_push('00000000-0000-0000-0000-00000000a001', true), true,
  'a follower turns on pushes for a topic they follow');
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(public.set_topic_push('00000000-0000-0000-0000-00000000a001', true), false,
  'a reader who neither owns nor follows the topic changes nothing');
reset role;
select is((select push_enabled from public.interests where id = '00000000-0000-0000-0000-00000000a001'),
  true, 'the owner''s switch is on the interest');

set local role service_role;
select results_eq($$ select s.endpoint || ' ' || t.topic
    from public.push_targets('00000000-0000-0000-0000-0000000f0001') t
    join public.push_subscriptions s on s.id = t.subscription_id order by 1 $$,
  array['https://fcm.googleapis.com/fcm/send/ben-laptop Trondheim events',
        'https://fcm.googleapis.com/fcm/send/hana-phone Trondheim events'],
  'a ready run notifies its owner and followers with the switch on, no one else');
select is((select count(*)::int from public.push_targets('00000000-0000-0000-0000-0000000f0002')), 0,
  'a run that is not ready notifies no one');
select lives_ok($$ delete from public.push_subscriptions
    where endpoint = 'https://fcm.googleapis.com/fcm/send/cleo-phone' $$,
  'the Worker deletes a device the push service no longer knows');
reset role;

-- ---------------------------------------------------------------------------
-- The outbox: finish_run queues, claim_outbox takes
-- ---------------------------------------------------------------------------

set local role service_role;
select public.finish_run('00000000-0000-0000-0000-0000000f0002', '## Trondheim events',
  '{"status":"covered"}'::jsonb, 1, 0.01);
select results_eq($$ select kind || ' ' || (payload ->> 'topic') from public.outbox order by id $$,
  array['push Trondheim events', 'push Trondheim events'],
  'a brief with stories queues one push per device');
reset role;

insert into public.runs (id, interest_id, status) values
  ('00000000-0000-0000-0000-0000000f0003', '00000000-0000-0000-0000-00000000a001', 'running');
set local role service_role;
select public.finish_run('00000000-0000-0000-0000-0000000f0003', '## Nothing new',
  '{"status":"empty"}'::jsonb, 1, 0.01);
select is((select count(*)::int from public.outbox), 2, 'a brief with no stories queues no push');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.outbox $$, '42501', null, 'a reader cannot read the outbox');
reset role;

-- Cleo signs in on Ben's laptop: its queued push is dropped, not sent to her.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ben-laptop', 'p-c2', 'a-c2');
reset role;
select is((select count(*)::int from public.outbox
    where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b'), 0,
  'a device that changes hands loses the old reader''s queued pushes');

set local role service_role;
select results_eq($$ select endpoint || ' ' || kind || ' ' || (payload ->> 'topic')
    from public.claim_outbox(10) $$,
  array['https://fcm.googleapis.com/fcm/send/hana-phone push Trondheim events'],
  'claim_outbox hands the Worker each queued push with its device');
select is((select count(*)::int from public.claim_outbox(10)), 0, 'and takes it off the queue');
reset role;

-- ---------------------------------------------------------------------------
-- The weekly push and topic popularity
-- ---------------------------------------------------------------------------

-- Cleo publishes a topic Ben follows; Hana turns her own switch off again.
insert into public.interests (id, owner_id, topic, doc, visibility, share_slug) values
  ('00000000-0000-0000-0000-00000000a002', 'cccccccc-0000-0000-0000-00000000000c',
   'Oslo jazz', '', 'public', 'oslojazzoslojazzoslojazz');
insert into public.follows (user_id, interest_id) values
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a002');
update public.interests set push_enabled = false where id = '00000000-0000-0000-0000-00000000a001';

set local role service_role;
select is((select followers from public.topic_popularity
    where interest_id = '00000000-0000-0000-0000-00000000a002'), 1,
  'topic_popularity counts followers');
select is(public.queue_weekly_pushes(now()), 1,
  'one weekly push per device, only for readers whose push-off topics got stories this week');
select results_eq($$ select user_id::text || ' ' || (payload ->> 'count') || ' '
    || (payload -> 'topics' ->> 0) || ' ' || (payload -> 'popular' -> 0 ->> 'title')
    from public.outbox where kind = 'weekly' $$,
  array['aaaaaaaa-0000-0000-0000-00000000000a 1 Trondheim events Oslo jazz'],
  'it names the reader''s topics with new stories and a popular public topic they lack');
select is(public.queue_weekly_pushes(now() + interval '8 days'), 0,
  'a week with no new stories queues nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Device rules: real push services only, at most 5 a reader
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.save_push_subscription('https://evil.example.test/x', 'p', 'a') $$,
  '23514', null, 'an endpoint that is not a known push service is refused');
select lives_ok($$ select public.save_push_subscription(
    'https://updates.push.services.mozilla.com/wpush/v2/x', 'p', 'a') $$, 'Firefox push is allowed');
select lives_ok($$ select public.save_push_subscription('https://web.push.apple.com/x', 'p', 'a') $$,
  'Safari push is allowed');
select lives_ok($$ select public.save_push_subscription('https://wns2-db5p.notify.windows.com/w/x', 'p', 'a') $$,
  'Windows push is allowed');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/hana-5', 'p', 'a');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/hana-6', 'p', 'a');
select is((select count(*)::int from public.push_subscriptions), 5, 'a reader keeps at most 5 devices');
select is((select count(*)::int from public.push_subscriptions
    where endpoint = 'https://fcm.googleapis.com/fcm/send/hana-phone'), 0,
  'the oldest device goes first');
reset role;

-- Checked by privilege, not by calling: the local Postgres image crashes the
-- backend when a role calls a function it lacks EXECUTE on (rls.test.sql).
select ok(not has_function_privilege('anon', 'public.save_push_subscription(text, text, text)', 'execute'),
  'signed out, nothing is saved');
select ok(not has_function_privilege('authenticated', 'public.push_targets(uuid)', 'execute'),
  'a reader cannot list who gets notified');
select ok(not has_function_privilege('authenticated', 'public.claim_outbox(integer)', 'execute'),
  'a reader cannot take queued pushes');
select ok(not has_function_privilege('authenticated', 'public.queue_weekly_pushes(timestamptz, uuid)', 'execute'),
  'a reader cannot queue the weekly push');
select ok(not has_table_privilege('authenticated', 'public.topic_popularity', 'select'),
  'a reader cannot read topic popularity');

select * from finish();
rollback;
