-- Deleting an account (prepare_account_delete, then the auth user goes) and the
-- daily cleanup_runs. Run with `pnpm test:rls` against `supabase start`, or
-- `pnpm test:rls:hosted`. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Setup (as postgres): Gro has everything an account can have; Ben follows her
-- and asked for runs of a topic she shared.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'gro@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', 'ben@example.test', 'authenticated', 'authenticated');
update public.profiles set display_name = 'Gro G' where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug, cadence, hidden_at) values
  ('00000000-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Gro shared', 'Shared doc.', 'shared', 'groshareddgroshareddgrosh', 'weekly', null),
  ('00000000-0000-0000-0000-00000000e002', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Gro hidden', 'Hidden doc.', 'shared', 'grohiddenngrohiddenngrohi', 'off', now()),
  ('00000000-0000-0000-0000-00000000e003', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Gro private', 'Private doc.', 'private', null, 'off', null),
  ('00000000-0000-0000-0000-00000000e004', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'Ben own', 'Ben doc.', 'shared', 'benownbenownbenownbenownb', 'off', null);
insert into public.follows (user_id, interest_id) values
  ('bbbbbbbb-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e001'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e002'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e004');
insert into public.runs (interest_id, status, requested_by, started_at, finished_at, cost_usd) values
  ('00000000-0000-0000-0000-00000000e001', 'ready', 'aaaaaaaa-0000-0000-0000-0000000000e1', now(), now(), 0.01),
  ('00000000-0000-0000-0000-00000000e004', 'ready', 'aaaaaaaa-0000-0000-0000-0000000000e1', now(), now(), 0.01);
insert into public.chat_turns (user_id, message, reply, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'hello', 'hi', 'ready');
insert into public.notifications (user_id, kind, payload) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'unshared', '{"topic":"x"}');
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-00000000e0a1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'https://fcm.googleapis.com/fcm/send/gro', 'p', 'a');
insert into public.outbox (kind, user_id, subscription_id, payload) values
  ('push', 'aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e0a1', '{}');

-- ---------------------------------------------------------------------------
-- prepare_account_delete: the Worker calls it, as the service role
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.prepare_account_delete(uuid)', 'execute'),
  'a reader cannot call prepare_account_delete');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.prepare_account_delete('aaaaaaaa-0000-0000-0000-0000000000e1'), 3,
  'every live interest is deleted');
reset role;
select set_config('request.jwt.claims', '', true);

select results_eq($$ select kind || ' ' || (payload ->> 'topic') || ' ' || (payload ? 'doc')::text
    from public.notifications where user_id = 'bbbbbbbb-0000-0000-0000-0000000000e2' order by 1 $$,
  array['deleted Gro shared true'],
  'the follower of a listed topic gets a deleted notice with a copy; a hidden one gives none');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select set_config('scout.copy', public.host_copy(
  (select id from public.notifications where kind = 'deleted'))::text, true);
select results_eq($$ select topic || ' ' || doc || ' ' || cadence from public.interests
    where id = current_setting('scout.copy')::uuid $$,
  array['Gro shared Shared doc. off'], 'the follower hosts a copy, switched off');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Deleting the auth user leaves no row that names it
-- ---------------------------------------------------------------------------

delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';

select is((select string_agg(t.table_name, ', ' order by t.table_name)
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and (xpath('/row/c/text()', query_to_xml(format(
            'select count(*) as c from public.%I x where x::text like ''%%aaaaaaaa-0000-0000-0000-0000000000e1%%''',
            t.table_name), false, true, '')))[1]::text::int > 0),
  null, 'no public table holds a row naming the deleted user');
select is((select count(*)::int from public.runs
    where interest_id = '00000000-0000-0000-0000-00000000e004'), 1,
  'a run Gro asked for on Ben''s topic stays, with no name on it');
select is((select count(*)::int from public.interests
    where owner_id = 'bbbbbbbb-0000-0000-0000-0000000000e2'), 2, 'Ben keeps his own topic and the copy');

-- ---------------------------------------------------------------------------
-- cleanup_runs: 30 days of runs, the latest ready brief kept
-- ---------------------------------------------------------------------------

insert into public.runs (id, interest_id, status, created_at, finished_at) values
  ('00000000-0000-0000-0000-0000000f0e01', '00000000-0000-0000-0000-00000000e004', 'ready',
   '2030-01-01', '2030-01-01'),
  ('00000000-0000-0000-0000-0000000f0e02', '00000000-0000-0000-0000-00000000e004', 'failed',
   '2030-01-02', null),
  ('00000000-0000-0000-0000-0000000f0e03', '00000000-0000-0000-0000-00000000e004', 'ready',
   '2030-01-03', '2030-01-03'),
  ('00000000-0000-0000-0000-0000000f0e04', '00000000-0000-0000-0000-00000000e004', 'ready',
   '2030-03-01', '2030-03-01');
-- Only the fixture runs of 2030 are in play: move the earlier one out of the way.
delete from public.runs where interest_id = '00000000-0000-0000-0000-00000000e004'
  and id::text not like '00000000-%';
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-00000000e0a2', 'bbbbbbbb-0000-0000-0000-0000000000e2',
   'https://fcm.googleapis.com/fcm/send/ben', 'p', 'a');
insert into public.outbox (kind, user_id, subscription_id, payload, created_at) values
  ('push', 'bbbbbbbb-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e0a2', '{"n":"old"}', '2030-03-15'),
  ('push', 'bbbbbbbb-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e0a2', '{"n":"new"}', '2030-03-16 12:00');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(public.cleanup_runs('2030-03-17 00:00+00') >= 2, 'cleanup runs');
reset role;
select results_eq($$ select id::text from public.runs
    where interest_id = '00000000-0000-0000-0000-00000000e004' order by created_at $$,
  array['00000000-0000-0000-0000-0000000f0e04'],
  'runs over 30 days old go, and the latest ready one is a recent one');
select results_eq($$ select payload ->> 'n' from public.outbox
    where user_id = 'bbbbbbbb-0000-0000-0000-0000000000e2' $$,
  array['new'], 'queued pushes over a day old go');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.cleanup_runs('2030-06-01 00:00+00') >= 0, true, 'a later cleanup');
reset role;
select results_eq($$ select id::text from public.runs
    where interest_id = '00000000-0000-0000-0000-00000000e004' $$,
  array['00000000-0000-0000-0000-0000000f0e04'],
  'an interest''s latest ready brief stays however old it is');

select * from finish();
rollback;
