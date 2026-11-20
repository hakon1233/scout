-- Reader feedback from the setup chat: send_feedback's switch, limits and the
-- free confirm turn, and the admin-only feedback table. Run with `pnpm test:sql`,
-- `pnpm test:rls` or `pnpm test:rls:hosted`. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'fay@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', 'finn@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-0000000000e3', 'flo@example.test', 'authenticated', 'authenticated');
update public.profiles set is_admin = true where id = 'cccccccc-0000-0000-0000-0000000000e3';

-- A fixed time far from the hosted project's real feedback.
select set_config('scout.t', '2030-02-01 12:00:00+00', true);

-- The card's turn: a ready chat turn of Fay's holding the feedback card.
insert into public.chat_turns (id, user_id, message, reply, pending, status, created_at) values
  ('11111111-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   'The feed is blank', 'Send it? Confirm below.',
   '{"feedback":{"kind":"bug","summary":"Feed is blank","text":"Nothing shows."}}',
   'ready', '2030-02-01 11:59:00+00');

select set_config('scout.turn',
  '{"id":"22222222-0000-0000-0000-0000000000e1","created_at":"2030-02-01T12:00:00Z",
    "status":"ready","message":"Send feedback: Feed is blank",
    "reply":"Sent to the Scout team. Thank you.","changes":[],"pending":null,"error_msg":null}',
  true);

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

select is((select feedback_on from public.settings), false, 'feedback starts switched off');
select throws_ok($$select public.send_feedback('aaaaaaaa-0000-0000-0000-0000000000e1',
    '11111111-0000-0000-0000-0000000000e1',
    '{"kind":"bug","summary":"Feed is blank","text":"Nothing shows."}',
    current_setting('scout.turn')::jsonb, current_setting('scout.t')::timestamptz)$$,
  '55000', null, 'while it is off nothing is sent');
update public.settings set feedback_on = true;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

select is(public.send_feedback('aaaaaaaa-0000-0000-0000-0000000000e1',
    '11111111-0000-0000-0000-0000000000e1',
    '{"kind":"bug","summary":"Feed is blank","text":"Nothing shows."}',
    current_setting('scout.turn')::jsonb, current_setting('scout.t')::timestamptz),
  null, 'a reader sends feedback');
select results_eq($$select user_id, kind, summary, text, plan, turn_id from public.feedback$$,
  $$values ('aaaaaaaa-0000-0000-0000-0000000000e1'::uuid, 'bug', 'Feed is blank',
            'Nothing shows.', 'free', '11111111-0000-0000-0000-0000000000e1'::uuid)$$,
  'the row holds who, kind, text, plan and the card''s turn');
select results_eq($$select reply, free from public.chat_turns
    where id = '22222222-0000-0000-0000-0000000000e1'$$,
  $$values ('Sent to the Scout team. Thank you.'::text, true)$$,
  'the confirm turn is stored and marked free');
select is((public.allowance('aaaaaaaa-0000-0000-0000-0000000000e1') -> 'used' ->> 'chat_turns_today')::int,
  1, 'the free confirm turn does not count as a chat message');

select throws_ok($$select public.send_feedback('aaaaaaaa-0000-0000-0000-0000000000e1',
    '11111111-0000-0000-0000-0000000000e1',
    '{"kind":"rant","summary":"x","text":"y"}',
    jsonb_set(current_setting('scout.turn')::jsonb, '{id}', '"22222222-0000-0000-0000-0000000000e9"'),
    current_setting('scout.t')::timestamptz)$$,
  '23514', null, 'an unknown kind is refused');
select throws_ok($$select public.send_feedback('bbbbbbbb-0000-0000-0000-0000000000e2',
    '11111111-0000-0000-0000-0000000000e1',
    '{"kind":"bug","summary":"x","text":"y"}',
    jsonb_set(current_setting('scout.turn')::jsonb, '{id}', '"22222222-0000-0000-0000-0000000000e8"'),
    current_setting('scout.t')::timestamptz)$$,
  '42501', null, 'a card from another reader''s chat cannot be sent');

-- ---------------------------------------------------------------------------
-- Limits: 5 a reader and 200 overall in 24 hours
-- ---------------------------------------------------------------------------

insert into public.feedback (user_id, turn_id, kind, summary, text, created_at)
select 'aaaaaaaa-0000-0000-0000-0000000000e1', gen_random_uuid(), 'wish', 'w' || g, 'w', '2030-02-01 11:00:00+00'
from generate_series(1, 4) g;
select matches(public.send_feedback('aaaaaaaa-0000-0000-0000-0000000000e1',
    '11111111-0000-0000-0000-0000000000e1',
    '{"kind":"wish","summary":"Sixth","text":"Sixth."}',
    jsonb_set(current_setting('scout.turn')::jsonb, '{id}', '"22222222-0000-0000-0000-0000000000e2"'),
    current_setting('scout.t')::timestamptz),
  'sent 5 notes', 'the sixth in 24 hours is refused in plain words');
select is((select count(*)::int from public.feedback where summary = 'Sixth'), 0,
  'and nothing is stored');
select matches((select reply from public.chat_turns where id = '22222222-0000-0000-0000-0000000000e2'),
  'sent 5 notes', 'the chat turn says why');
insert into public.chat_turns (id, user_id, message, status) values
  ('11111111-0000-0000-0000-0000000000e3', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'x', 'ready');
select is(public.send_feedback('aaaaaaaa-0000-0000-0000-0000000000e1',
    '11111111-0000-0000-0000-0000000000e3',
    '{"kind":"wish","summary":"Next day","text":"Next day."}',
    jsonb_set(current_setting('scout.turn')::jsonb, '{id}', '"22222222-0000-0000-0000-0000000000e3"'),
    current_setting('scout.t')::timestamptz + interval '25 hours'),
  null, 'the count rolls over 24 hours');
select is((select count(*)::int from public.feedback
    where turn_id = '11111111-0000-0000-0000-0000000000e1'), 1,
  'one card sends one note, however often it is confirmed');

insert into public.chat_turns (id, user_id, message, status) values
  ('11111111-0000-0000-0000-0000000000e2', 'bbbbbbbb-0000-0000-0000-0000000000e2', 'x', 'ready');
insert into public.feedback (user_id, turn_id, kind, summary, text, created_at)
select 'cccccccc-0000-0000-0000-0000000000e3', gen_random_uuid(), 'other', 'o', 'o', '2030-02-01 11:00:00+00'
from generate_series(1, 200 - 5) g;
select matches(public.send_feedback('bbbbbbbb-0000-0000-0000-0000000000e2',
    '11111111-0000-0000-0000-0000000000e2',
    '{"kind":"bug","summary":"Full","text":"Full."}',
    jsonb_set(current_setting('scout.turn')::jsonb, '{id}', '"22222222-0000-0000-0000-0000000000e4"'),
    current_setting('scout.t')::timestamptz),
  'full for today', 'past 200 a day overall nobody can send');

-- ---------------------------------------------------------------------------
-- Who can read and write
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is((select count(*)::int from public.feedback), 0, 'a reader cannot read feedback, not even their own');
select throws_ok($$insert into public.feedback (user_id, turn_id, kind, summary, text)
    values ('aaaaaaaa-0000-0000-0000-0000000000e1', gen_random_uuid(), 'bug', 'x', 'y')$$,
  '42501', null, 'a reader cannot insert feedback directly');
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select is((select count(*)::int from public.feedback), 200 + 1, 'an admin reads all feedback');
reset role;
select set_config('request.jwt.claims', '', true);

select ok(not has_table_privilege('anon', 'public.feedback', 'select'),
  'signed-out visitors cannot read feedback');
select ok(not has_function_privilege('authenticated', 'public.send_feedback(uuid, uuid, jsonb, jsonb, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.send_feedback(uuid, uuid, jsonb, jsonb, timestamptz)', 'execute'),
  'readers cannot call send_feedback; only the server can');
select ok(has_function_privilege('service_role', 'public.send_feedback(uuid, uuid, jsonb, jsonb, timestamptz)', 'execute'),
  'the service role sends feedback');

delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-0000000000e1';
select is((select count(*)::int from public.feedback
    where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'), 0,
  'deleting an account deletes its feedback');

select * from finish();
rollback;
