-- "Lots of pushes, mute some?": my_mute_suggestions counts a reader's pushes
-- in the last 7 days (covered briefs in topics with the bell on) and, from 10
-- on, names those topics, least read first; the weekly push names them too.
-- Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Mia has two topics with the bell on and one with it off. (Run Now and team
-- runs can push more than the cadence says, so pushes are counted, not guessed.)
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'mia@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'ola@example.test', 'authenticated', 'authenticated');

insert into public.interests (id, owner_id, topic, doc, cadence, push_enabled) values
  ('00000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   'Oslo traffic', '', 'weekly', true),
  ('00000000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   'NO3 power prices', '', 'weekly', true),
  ('00000000-0000-0000-0000-0000000000d3', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   'Rust releases', '', 'weekly', false);

-- Oslo traffic: 7 covered briefs this week. NO3: 5 this week, plus one not
-- covered and one older than a week, which sent no push this week.
insert into public.runs (interest_id, status, coverage, finished_at)
select '00000000-0000-0000-0000-0000000000d1'::uuid, 'ready', '{"status":"covered"}'::jsonb,
       now() - make_interval(hours => n * 20)
from generate_series(1, 7) n;
insert into public.runs (interest_id, status, coverage, finished_at)
select '00000000-0000-0000-0000-0000000000d2'::uuid, 'ready', '{"status":"covered"}'::jsonb,
       now() - make_interval(hours => n * 20)
from generate_series(1, 5) n;
insert into public.runs (interest_id, status, coverage, finished_at) values
  ('00000000-0000-0000-0000-0000000000d2', 'ready', '{"status":"empty"}', now()),
  ('00000000-0000-0000-0000-0000000000d2', 'ready', '{"status":"covered"}', now() - interval '8 days'),
  ('00000000-0000-0000-0000-0000000000d3', 'ready', '{"status":"covered"}', now());

-- Mia opened Oslo traffic's stories; she never opens NO3's.
insert into public.usage_events (user_id, kind, interest_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'story_click', '00000000-0000-0000-0000-0000000000d1'),
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'brief_view', '00000000-0000-0000-0000-0000000000d1');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

select is(public.my_mute_suggestions(), null::jsonb,
  'no device, no pushes: nothing to mute');

reset role;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'https://fcm.googleapis.com/fcm/send/mia-phone', 'k', 'a');
set local role authenticated;

select is(public.my_mute_suggestions(),
  jsonb_build_object('pushes', 12, 'topics', jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-0000-0000-0000000000d2', 'title', 'NO3 power prices', 'pushes', 5),
    jsonb_build_object('id', '00000000-0000-0000-0000-0000000000d1', 'title', 'Oslo traffic', 'pushes', 7))),
  '12 pushes this week: both bell-on topics, the unread one first');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select is(public.my_mute_suggestions(), null::jsonb, 'another reader sees only their own');

select throws_ok($$ select public.mute_suggestions('aaaaaaaa-0000-0000-0000-0000000000d1', now()) $$,
  '42501', null, 'a reader cannot ask about someone else');

reset role;
-- The weekly push names the topics to mute.
delete from public.outbox;
select ok(public.queue_weekly_pushes(now(), 'aaaaaaaa-0000-0000-0000-0000000000d1') = 1,
  'Mia gets one weekly push');
select is((select payload -> 'mute' from public.outbox
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'),
  '["NO3 power prices", "Oslo traffic"]'::jsonb, 'the weekly push names the topics to mute');

-- Muting one leaves 7 pushes a week: not lots any more.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select ok(public.set_topic_push('00000000-0000-0000-0000-0000000000d1', false), 'mute Oslo traffic');
select is(public.my_mute_suggestions(), null::jsonb, '7 pushes a week is not lots');

reset role;
delete from public.outbox;
select ok(public.queue_weekly_pushes(now(), 'aaaaaaaa-0000-0000-0000-0000000000d1') = 1,
  'the weekly push still goes');
select is((select payload -> 'mute' from public.outbox
           where user_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'),
  '[]'::jsonb, 'with few pushes it names nothing to mute');

select * from finish();
rollback;
