-- Pausing a topic (cadence off) frees its slot at once, and resuming it takes a
-- slot again only when one is free. The plan's daily and weekly caps count
-- only topics that are not paused. A paused topic remembers its cadence
-- (last_cadence) so Resume can give it back.
-- Run with `pnpm test:sql pause`, `pnpm test:rls` or `pnpm test:rls:hosted`.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'pia@example.test', 'authenticated', 'authenticated');
-- Pia is on Plus: 1 daily and 6 weekly.
update public.profiles set plan = 'plus' where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.interests (topic, cadence) values
    ('Pia daily', 'daily'),
    ('Pia weekly 1', 'weekly'), ('Pia weekly 2', 'weekly'), ('Pia weekly 3', 'weekly'),
    ('Pia weekly 4', 'weekly'), ('Pia weekly 5', 'weekly'), ('Pia weekly 6', 'weekly')$$,
  'Pia fills her daily slot and her six weekly slots');
select throws_ok(
  $$insert into public.interests (topic, cadence) values ('Pia weekly 7', 'weekly')$$,
  'P0001', 'quota: 6 of 6 weekly interests used', 'a seventh weekly topic is refused');

-- Pause: the slot is free at once.
select lives_ok(
  $$update public.interests set cadence = 'off' where topic = 'Pia weekly 1'$$,
  'Pia pauses a weekly topic');
select is((public.allowance() -> 'used' ->> 'weekly_interests')::int, 5,
  'a paused topic does not count toward the weekly cap');
select is((select last_cadence from public.interests where topic = 'Pia weekly 1'), 'weekly',
  'a paused topic remembers it was weekly');
select lives_ok(
  $$insert into public.interests (topic, cadence) values ('Pia weekly 7', 'weekly')$$,
  'the freed slot takes a new weekly topic');

-- Resume when full: refused, and the topic stays paused.
select throws_ok(
  $$update public.interests set cadence = 'weekly' where topic = 'Pia weekly 1'$$,
  'P0001', 'quota: 6 of 6 weekly interests used', 'resuming with no free weekly slot is refused');
select is((select cadence from public.interests where topic = 'Pia weekly 1'), 'off',
  'the refused topic stays paused');

-- The same for daily.
select lives_ok(
  $$update public.interests set cadence = 'off' where topic = 'Pia daily'$$,
  'Pia pauses her daily topic');
select is((public.allowance() -> 'used' ->> 'daily_interests')::int, 0,
  'a paused topic does not count toward the daily cap');
select is((select last_cadence from public.interests where topic = 'Pia daily'), 'daily',
  'a paused topic remembers it was daily');
select lives_ok(
  $$update public.interests set cadence = 'daily' where topic = 'Pia weekly 2'$$,
  'the freed daily slot can go to another topic');
select is((select last_cadence from public.interests where topic = 'Pia weekly 2'), null,
  'a topic that was never paused remembers nothing');
select throws_ok(
  $$update public.interests set cadence = 'daily' where topic = 'Pia daily'$$,
  'P0001', 'quota: 1 of 1 daily interests used', 'resuming with no free daily slot is refused');

-- With room again, Resume works.
select lives_ok(
  $$update public.interests set cadence = 'weekly' where topic = 'Pia daily'$$,
  'a paused daily topic resumes weekly when that slot is free');
select is((select last_cadence from public.interests where topic = 'Pia daily'), 'daily',
  'resuming keeps what it remembered until it is paused again');

select throws_ok(
  $$update public.interests set last_cadence = 'daily' where topic = 'Pia weekly 3'$$,
  '42501', null, 'readers cannot write last_cadence themselves');

select * from finish();
rollback;
