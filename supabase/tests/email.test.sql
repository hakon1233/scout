-- Email tests: the per-topic email switch (off by default, only the reader's
-- own, only through set_topic_email, refused while email is switched off), the
-- queue a ready run fills, and the Worker's claim, sent mark and unsubscribe.
-- Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Hana hosts a shared topic, Ben follows it, Cleo does neither.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'hana@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', 'ben@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-0000000000e3', 'cleo@example.test', 'authenticated', 'authenticated');

insert into public.interests (id, owner_id, topic, doc, visibility, share_slug) values
  ('00000000-0000-0000-0000-0000000e0001', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'Trondheim events', '', 'shared', 'emailtrondheimemailtrondheim');
insert into public.follows (user_id, interest_id) values
  ('bbbbbbbb-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000e0001');

insert into public.runs (id, interest_id, status) values
  ('00000000-0000-0000-0000-0000000ef001', '00000000-0000-0000-0000-0000000e0001', 'running');

-- ---------------------------------------------------------------------------
-- Switched off (the default): the app behaves as before
-- ---------------------------------------------------------------------------

select is((select email_on from public.settings), false, 'email starts switched off');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is(public.my_topic_email(), null::uuid[], 'switched off: the app gets null and hides the toggles');
select throws_ok($$ select public.set_topic_email('00000000-0000-0000-0000-0000000e0001', true) $$,
  '55000', null, 'switched off: no toggle can be turned on');
reset role;

-- A reader who had it on (set before a switch-off) still gets nothing queued.
update public.interests set email_enabled = true where id = '00000000-0000-0000-0000-0000000e0001';
update public.runs set status = 'ready', section_md = '## Trondheim events', coverage = '{"status":"covered"}'
where id = '00000000-0000-0000-0000-0000000ef001';
select is((select count(*)::int from public.email_outbox), 0, 'switched off: a ready run queues no email');
set local role service_role;
select is(public.claim_emails(10), null::jsonb, 'switched off: the Worker claims nothing');
reset role;
update public.interests set email_enabled = false where id = '00000000-0000-0000-0000-0000000e0001';

-- ---------------------------------------------------------------------------
-- Switched on: each reader's own toggle
-- ---------------------------------------------------------------------------

update public.settings set email_on = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is(public.my_topic_email(), '{}'::uuid[], 'every topic starts with email off');
select is(public.set_topic_email('00000000-0000-0000-0000-0000000e0001', true), true,
  'the owner turns on email for their topic');
select is(public.my_topic_email(), array['00000000-0000-0000-0000-0000000e0001']::uuid[],
  'and sees it on');
select throws_ok($$ update public.interests set email_enabled = false
    where id = '00000000-0000-0000-0000-0000000e0001' $$,
  '42501', null, 'the column is not written directly, only through set_topic_email');
select throws_ok($$ select * from public.email_outbox $$,
  '42501', null, 'a reader cannot read the email queue');
select throws_ok($$ select public.claim_emails(10) $$,
  '42501', null, 'a reader cannot claim emails');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select is(public.my_topic_email(), '{}'::uuid[], 'a follower does not see the owner''s switch');
select is(public.set_topic_email('00000000-0000-0000-0000-0000000e0001', true), true,
  'a follower turns on email for a topic they follow');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select is(public.set_topic_email('00000000-0000-0000-0000-0000000e0001', true), false,
  'a reader who neither owns nor follows the topic changes nothing');
select throws_ok($$ update public.follows set email_enabled = false $$,
  '42501', null, 'no one writes a follow''s switch directly');
reset role;

select is((select email_enabled from public.follows
    where user_id = 'bbbbbbbb-0000-0000-0000-0000000000e2'), true, 'the follower''s switch is on the follow');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(not has_function_privilege('anon', 'public.set_topic_email(uuid, boolean)', 'execute'),
  'signed out, no toggle');
reset role;

-- ---------------------------------------------------------------------------
-- The queue: one email per reader per brief
-- ---------------------------------------------------------------------------

insert into public.runs (id, interest_id, status) values
  ('00000000-0000-0000-0000-0000000ef002', '00000000-0000-0000-0000-0000000e0001', 'running');
update public.runs set status = 'ready', section_md = '## Trondheim events', coverage = '{"status":"empty"}'
where id = '00000000-0000-0000-0000-0000000ef002';
select is((select count(*)::int from public.email_outbox), 0, 'a run with no stories emails no one');

insert into public.runs (id, interest_id, status) values
  ('00000000-0000-0000-0000-0000000ef003', '00000000-0000-0000-0000-0000000e0001', 'running');
update public.runs set status = 'ready', section_md = E'## Trondheim events\n- `2026-11-20` — A fair.',
  coverage = '{"status":"covered"}'
where id = '00000000-0000-0000-0000-0000000ef003';
select results_eq($$ select user_id::text from public.email_outbox order by 1 $$,
  array['aaaaaaaa-0000-0000-0000-0000000000e1', 'bbbbbbbb-0000-0000-0000-0000000000e2'],
  'a ready brief queues one email for the owner and one for the follower');

update public.runs set status = 'running' where id = '00000000-0000-0000-0000-0000000ef003';
update public.runs set status = 'ready' where id = '00000000-0000-0000-0000-0000000ef003';
select is((select count(*)::int from public.email_outbox), 2, 'never twice for the same brief');

-- ---------------------------------------------------------------------------
-- The Worker's side
-- ---------------------------------------------------------------------------

set local role service_role;
select is((select jsonb_array_length(public.claim_emails(10))), 2, 'the Worker claims both');
select is((select e ->> 'to' from jsonb_array_elements(public.claim_emails(10)) e), null,
  'a claimed email is not claimed again');
reset role;

-- Ben's arrives with his address from auth, the topic and the brief.
update public.email_outbox set claimed_at = null;
set local role service_role;
select results_eq($$ select (e ->> 'to') || ' ' || (e ->> 'topic') || ' ' || (e ->> 'sent_today')
    from jsonb_array_elements(public.claim_emails(10)) e order by 1 $$,
  array['ben@example.test Trondheim events 0', 'hana@example.test Trondheim events 0'],
  'each with the reader''s address, the topic and the day''s count');
select lives_ok($$ select public.emails_sent(
    (select array_agg(id) from public.email_outbox where user_id = 'bbbbbbbb-0000-0000-0000-0000000000e2')) $$,
  'the Worker marks what it sent');
reset role;
select is((select count(*)::int from public.email_outbox where sent_at is not null), 1, 'one marked sent');

-- Unsubscribe: the follower's link turns his switch off, and only his.
set local role service_role;
select is(public.email_unsubscribe('bbbbbbbb-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000e0001'),
  'Trondheim events', 'an unsubscribe link turns that topic''s email off');
select is(public.email_unsubscribe('cccccccc-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000e0001'),
  null, 'a link for a topic the reader has nothing to do with changes nothing');
reset role;
select is((select email_enabled from public.follows
    where user_id = 'bbbbbbbb-0000-0000-0000-0000000000e2'), false, 'the follower is off');
select is((select email_enabled from public.interests
    where id = '00000000-0000-0000-0000-0000000e0001'), true, 'the owner is still on');

select * from finish();
rollback;
