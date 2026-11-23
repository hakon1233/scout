-- Setup chat tests: chat_block_reason, commit_chat_turn and the plans.max_interests
-- cap. Run with `pnpm test:rls` against `supabase start`, or `pnpm test:rls:hosted`.
-- Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The hosted project holds real spend today, so spend is measured from a
-- baseline taken before any fixture costs.
select set_config('scout.spend_base', public.spend_today('2026-11-20 10:05+00')::text, true);

-- ---------------------------------------------------------------------------
-- Setup (as postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.test', 'authenticated', 'authenticated');

insert into public.interests (id, owner_id, topic, doc, visibility) values
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Anna old', 'old doc', 'private'),
  ('00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Ben private', 'ben doc', 'private'),
  ('00000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Catalog public', '', 'public');

-- ---------------------------------------------------------------------------
-- chat_block_reason
-- ---------------------------------------------------------------------------

select is(public.chat_block_reason('aaaaaaaa-0000-0000-0000-000000000001'), null,
  'a reader with turns left may chat');

update public.settings set paused = true;
select matches(public.chat_block_reason('aaaaaaaa-0000-0000-0000-000000000001'),
  'paused', 'kill switch: chat is blocked');
update public.settings set paused = false;

insert into public.chat_turns (user_id, message, cost_usd)
select 'bbbbbbbb-0000-0000-0000-000000000002', 'hi ' || g, 0
from generate_series(1, (select chat_turns_per_day from public.plans where id = 'free')) g;
select matches(public.chat_block_reason('bbbbbbbb-0000-0000-0000-000000000002'),
  'chat messages', 'daily turn limit reached: chat is blocked');
select is(public.chat_block_reason('aaaaaaaa-0000-0000-0000-000000000001'), null,
  'another reader''s turns do not count');
delete from public.chat_turns where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- commit_chat_turn
-- ---------------------------------------------------------------------------

select lives_ok($$
  select public.commit_chat_turn('aaaaaaaa-0000-0000-0000-000000000001',
    '{"id":"11111111-0000-0000-0000-000000000001","created_at":"2026-11-20T10:00:00Z",
      "status":"ready","message":"set me up","reply":"done",
      "changes":[
        {"op":"create","interestId":"00000000-0000-0000-0000-0000000000a2","topic":"Anna new","doc":"new doc"},
        {"op":"update","interestId":"00000000-0000-0000-0000-0000000000a1","topic":"Anna renamed"},
        {"op":"update","interestId":"00000000-0000-0000-0000-0000000000b1","topic":"hijacked"}
      ],
      "pending":{"deletes":[{"interestId":"00000000-0000-0000-0000-0000000000a1","topic":"Anna renamed"}]},
      "error_msg":null}'::jsonb,
    array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1']::uuid[],
    0.0123, 2150, 310)
$$, 'commit_chat_turn applies a turn');

select is((select topic || '|' || doc from public.interests where id = '00000000-0000-0000-0000-0000000000a2'
           and owner_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Anna new|new doc', 'create: the interest is the reader''s');
select is((select topic || '|' || doc from public.interests where id = '00000000-0000-0000-0000-0000000000a1'),
  'Anna renamed|old doc', 'update: a missing doc keeps the old one');
select is((select topic from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  'Ben private', 'update: someone else''s interest is untouched');
select results_eq(
  $$select interest_id from public.follows where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  array['00000000-0000-0000-0000-0000000000c1'::uuid],
  'follows: only live public interests are followed');
select is((select status || '|' || reply || '|' || cost_usd::text || '|' || (pending -> 'deletes' -> 0 ->> 'topic')
           from public.chat_turns where id = '11111111-0000-0000-0000-000000000001'),
  'ready|done|0.0123|Anna renamed', 'the turn is stored with its pending deletes and cost');
select is((select input_tokens || ' ' || output_tokens from public.chat_turns
           where id = '11111111-0000-0000-0000-000000000001'),
  '2150 310', 'and the tokens its model call used');
select is((select jsonb_array_length(changes) from public.chat_turns
           where id = '11111111-0000-0000-0000-000000000001'), 3, 'changes are stored');
select is(public.spend_today('2026-11-20 10:05+00') - current_setting('scout.spend_base')::numeric, 0.0123::numeric, 'the turn''s cost counts toward today''s spend');

select lives_ok($$
  select public.commit_chat_turn('aaaaaaaa-0000-0000-0000-000000000001',
    '{"id":"11111111-0000-0000-0000-000000000002","status":"ready","message":"drop it",
      "changes":[
        {"op":"delete","interestId":"00000000-0000-0000-0000-0000000000a1"},
        {"op":"delete","interestId":"00000000-0000-0000-0000-0000000000b1"}
      ]}'::jsonb, null, null)
$$, 'a turn with deletes, no follows and no cost');
select isnt((select deleted_at from public.interests where id = '00000000-0000-0000-0000-0000000000a1'),
  null, 'delete: the reader''s interest is soft deleted');
select is((select deleted_at from public.interests where id = '00000000-0000-0000-0000-0000000000b1'),
  null, 'delete: someone else''s interest is untouched');
select is((select cost_usd from public.chat_turns where id = '11111111-0000-0000-0000-000000000002'),
  0::numeric, 'a missing cost is stored as zero');
select is((select input_tokens from public.chat_turns where id = '11111111-0000-0000-0000-000000000002'),
  null::bigint, 'missing tokens stay unknown');

select throws_ok($$
  select public.commit_chat_turn('aaaaaaaa-0000-0000-0000-000000000001',
    '{"id":"11111111-0000-0000-0000-000000000003","status":"ready","message":"x",
      "changes":[{"op":"create","interestId":"00000000-0000-0000-0000-0000000000a3","topic":"ok"},
                 {"op":"rename","interestId":"00000000-0000-0000-0000-0000000000a1"}]}'::jsonb,
    null, 0)
$$, 'P0001', null, 'an unknown op fails the turn');
select is((select count(*)::int from public.interests where id = '00000000-0000-0000-0000-0000000000a3'),
  0, 'a failed turn leaves no changes behind');

-- ---------------------------------------------------------------------------
-- plans.max_interests
-- ---------------------------------------------------------------------------

select is((public.allowance('aaaaaaaa-0000-0000-0000-000000000001') -> 'limits' ->> 'max_interests')::int,
  15, 'allowance reports the free plan''s interest cap');

update public.plans set max_interests = 3 where id = 'free';
-- Anna has one live interest (Anna new); a public one she owns would not count.
insert into public.interests (owner_id, topic) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Anna two'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Anna three');
select throws_ok($$
  insert into public.interests (owner_id, topic)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Anna four')
$$, 'P0001', null, 'an insert past the cap fails');
select throws_ok($$
  select public.commit_chat_turn('aaaaaaaa-0000-0000-0000-000000000001',
    '{"id":"11111111-0000-0000-0000-000000000004","status":"ready","message":"more",
      "changes":[{"op":"create","interestId":"00000000-0000-0000-0000-0000000000a4","topic":"Anna four"}]}'::jsonb,
    null, 0)
$$, 'P0001', null, 'a chat turn cannot create past the cap');
select throws_ok($$
  update public.interests set deleted_at = null where id = '00000000-0000-0000-0000-0000000000a1'
$$, 'P0001', null, 'restoring a deleted interest past the cap fails');
select lives_ok($$
  update public.interests set doc = 'edited' where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and deleted_at is null
$$, 'edits at the cap still work');
update public.plans set max_interests = 15 where id = 'free';

-- ---------------------------------------------------------------------------
-- A reader cannot call the chat functions (the Worker does, as service role)
-- ---------------------------------------------------------------------------

-- Checked by privilege, not by calling (see rls.test.sql: the local Postgres image
-- crashes the backend when a role calls a function it lacks EXECUTE on).
-- p_user is the Worker's verified reader id, so EXECUTE is the whole guard.
select ok(not has_function_privilege('authenticated',
  'public.commit_chat_turn(uuid, jsonb, uuid[], numeric, bigint, bigint)', 'execute'),
  'a reader cannot commit turns, for someone else or themselves');
select ok(not has_function_privilege('anon',
  'public.commit_chat_turn(uuid, jsonb, uuid[], numeric, bigint, bigint)', 'execute'),
  'anon cannot commit turns');
select ok(not has_function_privilege('authenticated',
  'public.chat_block_reason(uuid)', 'execute'),
  'a reader cannot call chat_block_reason');
select ok(has_function_privilege('service_role',
  'public.commit_chat_turn(uuid, jsonb, uuid[], numeric, bigint, bigint)', 'execute')
  and has_function_privilege('service_role', 'public.chat_block_reason(uuid)', 'execute'),
  'the service role can call both');

select * from finish();
rollback;
