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
    'https://push.example.test/hana-phone', 'p256-hana', 'auth-hana') $$,
  'a reader saves a device');
select lives_ok($$ select public.save_push_subscription(
    'https://push.example.test/hana-phone', 'p256-hana-2', 'auth-hana-2') $$,
  'saving the same device again updates it');
select results_eq($$ select p256dh from public.push_subscriptions $$,
  array['p256-hana-2'], 'one row per device, with the newest keys');

select throws_ok($$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', 'https://push.example.test/fake', 'x', 'y') $$,
  '42501', null, 'no one adds a device for someone else');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select lives_ok($$ select public.save_push_subscription(
    'https://push.example.test/ben-laptop', 'p256-ben', 'auth-ben') $$,
  'another reader saves their own device');
select results_eq($$ select endpoint from public.push_subscriptions $$,
  array['https://push.example.test/ben-laptop'], 'a reader sees only their own devices');

delete from public.push_subscriptions where endpoint = 'https://push.example.test/hana-phone';
reset role;
select is((select count(*)::int from public.push_subscriptions
    where endpoint = 'https://push.example.test/hana-phone'), 1,
  'no one deletes someone else''s device');

-- Cleo signs in on Hana's phone: the device is hers now.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select lives_ok($$ select public.save_push_subscription(
    'https://push.example.test/hana-phone', 'p256-cleo', 'auth-cleo') $$,
  'a device that changes hands is saved for its new reader');
reset role;
select results_eq($$ select user_id::text from public.push_subscriptions
    where endpoint = 'https://push.example.test/hana-phone' $$,
  array['cccccccc-0000-0000-0000-00000000000c'], 'and stops notifying its old reader');

set local role authenticated;
select lives_ok($$ delete from public.push_subscriptions
    where endpoint = 'https://push.example.test/hana-phone' $$, 'a reader deletes their own device');
reset role;
select is((select count(*)::int from public.push_subscriptions
    where endpoint = 'https://push.example.test/hana-phone'), 0, 'it is gone');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.push_subscriptions $$,
  '42501', null, 'signed out, nothing is read');

-- ---------------------------------------------------------------------------
-- push_targets: the Worker's list for a ready run
-- ---------------------------------------------------------------------------

reset role;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'https://push.example.test/hana-phone', 'p-h', 'a-h'),
  ('cccccccc-0000-0000-0000-00000000000c', 'https://push.example.test/cleo-phone', 'p-c', 'a-c');

set local role service_role;
select results_eq($$ select endpoint || ' ' || topic from public.push_targets(
    '00000000-0000-0000-0000-0000000f0001') order by endpoint $$,
  array['https://push.example.test/ben-laptop Trondheim events',
        'https://push.example.test/hana-phone Trondheim events'],
  'a ready run notifies its owner and followers, no one else');
select is((select count(*)::int from public.push_targets('00000000-0000-0000-0000-0000000f0002')), 0,
  'a run that is not ready notifies no one');
select lives_ok($$ delete from public.push_subscriptions
    where endpoint = 'https://push.example.test/cleo-phone' $$,
  'the Worker deletes a device the push service no longer knows');

reset role;
-- Checked by privilege, not by calling: the local Postgres image crashes the
-- backend when a role calls a function it lacks EXECUTE on (rls.test.sql).
select ok(not has_function_privilege('anon', 'public.save_push_subscription(text, text, text)', 'execute'),
  'signed out, nothing is saved');
select ok(not has_function_privilege('authenticated', 'public.push_targets(uuid)', 'execute'),
  'a reader cannot list who gets notified');

select * from finish();
rollback;
