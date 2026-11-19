-- RLS, grants and quota tests. Run with `pnpm test:rls` against `supabase start`.
--
-- Anna and Ben are signed-in readers; "anon" is a signed-out visitor.
-- Each block switches role with `set local role` and the JWT claims auth.uid() reads,
-- and `reset role` returns to postgres (the service side) for setup and checks.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Setup (as postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.test', 'authenticated', 'authenticated');

-- Sign-up already made both profiles (free, UTC).
update public.profiles set timezone = 'Europe/Oslo'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug, cadence) values
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna private', 'private doc', 'private', null, 'off'),
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna shared', 'shared doc', 'shared', 'shared-slug-aaaaaaaaaaaaaaaa', 'off'),
  ('00000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001',
   'House public', 'public doc', 'public', 'public-slug-aaaaaaaaaaaaaaaa', 'daily'),
  ('00000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Deleted public', 'gone', 'public', 'public-slug-deleted-aaaaaaaa', 'off');
update public.interests set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000a4';

insert into public.runs (interest_id, status, section_md) values
  ('00000000-0000-0000-0000-0000000000a1', 'ready', 'private section'),
  ('00000000-0000-0000-0000-0000000000a2', 'ready', 'shared section'),
  ('00000000-0000-0000-0000-0000000000a3', 'ready', 'public section'),
  ('00000000-0000-0000-0000-0000000000a4', 'ready', 'deleted section');

insert into public.chat_turns (user_id, message) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna asks'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben asks');

insert into public.notifications (id, user_id, kind) values
  ('00000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'run_failed'),
  ('00000000-0000-0000-0000-0000000000f2', 'bbbbbbbb-0000-0000-0000-000000000002', 'over_quota');

-- ---------------------------------------------------------------------------
-- Every table has RLS on
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every public table has RLS enabled');

select is(
  (select count(*)::int from public.plans where id = 'free'
     and daily_interests = 1 and weekly_interests = 3),
  1, 'free plan is 1 daily + 3 weekly');
select is((select count(*)::int from public.settings), 1, 'settings has one row');

-- ---------------------------------------------------------------------------
-- Signed-out visitor
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select results_eq(
  'select topic from public.interests order by topic',
  array['House public'],
  'anon reads only live public interests');
select results_eq(
  'select section_md from public.runs order by section_md',
  array['public section'],
  'anon reads only runs of live public interests');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.follows', '42501', null, 'anon cannot read follows');
select throws_ok('select * from public.chat_turns', '42501', null, 'anon cannot read chat turns');
select throws_ok('select * from public.notifications', '42501', null, 'anon cannot read notifications');
select throws_ok('select * from public.plans', '42501', null, 'anon cannot read plans');
select throws_ok('select * from public.settings', '42501', null, 'anon cannot read settings');
select throws_ok(
  $$insert into public.interests (topic) values ('x')$$, '42501', null,
  'anon cannot create interests');

reset role;

-- Checked by privilege, not by calling: the local Postgres image (17.6) crashes the
-- backend when a role calls a function it lacks EXECUTE on.
select ok(not has_function_privilege('anon', 'public.allowance(uuid)', 'execute'),
  'anon cannot call allowance');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname not in ('allowance', 'is_time_zone')
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients may call only allowance and is_time_zone');

-- ---------------------------------------------------------------------------
-- Ben, who follows nothing yet
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  'select topic from public.interests order by topic',
  array['House public'],
  'Ben sees only the public interest before following');
select results_eq(
  'select section_md from public.runs order by section_md',
  array['public section'],
  'Ben sees only public runs before following');
select results_eq(
  'select id::text from public.profiles',
  array['bbbbbbbb-0000-0000-0000-000000000002'],
  'Ben reads only his own profile');
select results_eq(
  'select message from public.chat_turns',
  array['ben asks'],
  'Ben reads only his own chat turns');
select results_eq(
  'select kind from public.notifications',
  array['over_quota'],
  'Ben reads only his own notifications');
select is((select count(*)::int from public.plans), 1, 'Ben reads the plans');
select throws_ok('select * from public.settings', '42501', null, 'Ben cannot read settings');

-- Writes Ben must not make.
select throws_ok(
  $$insert into public.follows (user_id, interest_id)
    values ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'Ben cannot insert a follow directly (RPC only)');
update public.interests set topic = 'hijacked' where id = '00000000-0000-0000-0000-0000000000a1';
update public.interests set topic = 'hijacked' where id = '00000000-0000-0000-0000-0000000000a3';
update public.notifications set read_at = now() where id = '00000000-0000-0000-0000-0000000000f1';
select throws_ok(
  $$insert into public.runs (interest_id) values ('00000000-0000-0000-0000-0000000000a3')$$,
  '42501', null, 'Ben cannot create runs');
select throws_ok(
  $$update public.runs set section_md = 'x'$$, '42501', null, 'Ben cannot edit runs');
select throws_ok(
  $$insert into public.chat_turns (user_id, message)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'x')$$,
  '42501', null, 'Ben cannot write chat turns (chat function only)');
select throws_ok(
  $$update public.profiles set plan = 'free'$$, '42501', null, 'Ben cannot change his plan');
select throws_ok(
  $$update public.profiles set is_admin = true$$, '42501', null, 'Ben cannot make himself admin');
select throws_ok(
  $$update public.plans set daily_interests = 99$$, '42501', null, 'Ben cannot edit plans');
select throws_ok(
  $$update public.notifications set payload = '{}'$$, '42501', null,
  'Ben can update only read_at on notifications');
select throws_ok(
  $$insert into public.interests (owner_id, topic)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'planted')$$,
  '42501', null, 'Ben cannot create an interest for Anna');
select throws_ok(
  $$update public.interests set visibility = 'public'$$, '42501', null,
  'Ben cannot set visibility directly');
select throws_ok(
  $$delete from public.interests$$, '42501', null, 'interests are soft-deleted, never deleted');
select throws_ok(
  $$select public.allowance('aaaaaaaa-0000-0000-0000-000000000001')$$, '42501', null,
  'Ben cannot read Anna''s allowance');

-- Allowed for Ben.
select lives_ok($$update public.profiles set timezone = 'America/New_York'$$,
  'Ben changes his own time zone');
select throws_ok($$update public.profiles set timezone = 'Mars/Olympus'$$, '23514', null,
  'an unknown time zone is refused');
select lives_ok(
  $$update public.notifications set read_at = now()
    where id = '00000000-0000-0000-0000-0000000000f2'$$,
  'Ben marks his notification read');
select is(public.allowance() ->> 'plan', 'free', 'Ben''s allowance shows the free plan');

reset role;

select is(
  (select count(*)::int from public.interests where topic = 'hijacked'), 0,
  'Ben''s updates to Anna''s interests changed nothing');
select is(
  (select read_at from public.notifications where id = '00000000-0000-0000-0000-0000000000f1'),
  null, 'Ben''s update to Anna''s notification changed nothing');

-- ---------------------------------------------------------------------------
-- Ben follows the shared interest (the follow RPC's job, done here as postgres)
-- ---------------------------------------------------------------------------

insert into public.follows (user_id, interest_id) values
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  'select topic from public.interests order by topic',
  array['Anna shared', 'House public'],
  'Ben reads the shared interest he follows, never a private one even with a follow row');
select results_eq(
  'select section_md from public.runs order by section_md',
  array['public section', 'shared section'],
  'Ben reads runs of the shared interest he follows');
update public.interests set doc = 'edited' where id = '00000000-0000-0000-0000-0000000000a2';
select lives_ok(
  $$delete from public.follows where interest_id = '00000000-0000-0000-0000-0000000000a2'$$,
  'Ben unfollows');
select results_eq(
  'select topic from public.interests order by topic',
  array['House public'],
  'after unfollowing, the shared interest is gone from Ben''s view');

reset role;

select is(
  (select doc from public.interests where id = '00000000-0000-0000-0000-0000000000a2'),
  'shared doc', 'a follower cannot edit what he follows');

-- ---------------------------------------------------------------------------
-- Anna: her own rows, and quotas (free: 1 daily + 3 weekly, doc <= 4000)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  'select topic from public.interests order by topic',
  array['Anna private', 'Anna shared', 'Deleted public', 'House public'],
  'Anna reads all her interests, deleted ones included');
select results_eq(
  'select section_md from public.runs order by section_md',
  array['deleted section', 'private section', 'public section', 'shared section'],
  'Anna reads the runs of all her interests');
select is((select count(*)::int from public.follows), 0, 'Anna cannot see Ben''s follows');

-- The public daily interest is on no one's quota, so Anna's one daily slot is free.
select is((public.allowance() -> 'used' ->> 'daily_interests')::int, 0,
  'a public interest does not count against the owner');
select lives_ok(
  $$insert into public.interests (topic, cadence) values ('daily one', 'daily')$$,
  'Anna adds her one daily interest');
select throws_ok(
  $$insert into public.interests (topic, cadence) values ('daily two', 'daily')$$,
  'P0001', 'quota: 1 of 1 daily interests used', 'a second daily interest is refused');
select throws_ok(
  $$update public.interests set cadence = 'daily'
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', null, 'switching an interest to daily past the quota is refused');
select lives_ok(
  $$insert into public.interests (topic, cadence) values
    ('weekly one', 'weekly'), ('weekly two', 'weekly'), ('weekly three', 'weekly')$$,
  'Anna adds three weekly interests');
select throws_ok(
  $$insert into public.interests (topic, cadence) values ('weekly four', 'weekly')$$,
  'P0001', 'quota: 3 of 3 weekly interests used', 'a fourth weekly interest is refused');
select lives_ok(
  $$insert into public.interests (topic, cadence) values ('paused', 'off')$$,
  'interests that are off are not limited');
select lives_ok(
  $$update public.interests set run_at = '08:30', topic = 'daily one, renamed'
    where topic = 'daily one'$$,
  'editing an interest that already counts is not re-checked');

-- Freeing a slot: switch off, or soft-delete.
select lives_ok(
  $$update public.interests set cadence = 'off' where topic = 'daily one, renamed'$$,
  'Anna pauses her daily interest');
select lives_ok(
  $$update public.interests set cadence = 'daily'
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'the freed daily slot can be used again');
select lives_ok(
  $$update public.interests set deleted_at = now() where topic = 'weekly one'$$,
  'Anna soft-deletes a weekly interest');
select lives_ok(
  $$insert into public.interests (topic, cadence) values ('weekly four', 'weekly')$$,
  'a soft-deleted interest frees its slot');
select throws_ok(
  $$update public.interests set deleted_at = null where topic = 'weekly one'$$,
  'P0001', null, 'restoring a deleted interest past the quota is refused');

select throws_ok(
  format($$insert into public.interests (topic, doc) values ('long', %L)$$, repeat('x', 4001)),
  'P0001', 'quota: intent doc is longer than 4000 characters',
  'an intent doc over max_doc_chars is refused');
select lives_ok(
  format($$insert into public.interests (topic, doc) values ('long', %L)$$, repeat('x', 4000)),
  'an intent doc at max_doc_chars is accepted');

select is(
  public.allowance() -> 'used',
  '{"daily_interests": 1, "weekly_interests": 3, "on_demand_runs_today": 0, "chat_turns_today": 1}'::jsonb,
  'allowance counts what Anna uses');
select is(
  public.allowance() -> 'limits',
  '{"daily_interests": 1, "weekly_interests": 3, "on_demand_runs_per_day": 3, "chat_turns_per_day": 40, "searches_per_run": 5, "max_doc_chars": 4000}'::jsonb,
  'allowance reads the limits from the plans table');

reset role;

-- ---------------------------------------------------------------------------
-- Service side
-- ---------------------------------------------------------------------------

select is((public.allowance('aaaaaaaa-0000-0000-0000-000000000001') ->> 'plan'), 'free',
  'the service side reads anyone''s allowance');

insert into public.runs (interest_id, status, requested_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'queued', 'aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (public.allowance('aaaaaaaa-0000-0000-0000-000000000001') -> 'used' ->> 'on_demand_runs_today')::int,
  1, 'an on-demand run counts for the user who asked');
select throws_ok(
  $$insert into public.runs (interest_id, status)
    values ('00000000-0000-0000-0000-0000000000a1', 'running')$$,
  '23505', null, 'single flight: one queued or running run per interest');

-- Raising a limit is one update, no deploy.
update public.plans set daily_interests = 2 where id = 'free';
select is(
  (public.allowance('aaaaaaaa-0000-0000-0000-000000000001') -> 'limits' ->> 'daily_interests')::int,
  2, 'a plan change shows up in allowance at once');

select * from finish();
rollback;
