-- Voice limits: begin_voice_clip's per-reader count, global neuron budget and
-- kill switch. Run with `pnpm test:rls` or `pnpm test:rls:hosted`. Everything
-- rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'vera@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'vic@example.test', 'authenticated', 'authenticated');

-- A fixed day far from the hosted project's real clips.
select set_config('scout.t', '2030-01-02 12:00:00+00', true);

select ok(public.begin_voice_clip('aaaaaaaa-0000-0000-0000-0000000000f1',
  current_setting('scout.t')::timestamptz) ? 'id', 'a reader with clips left gets one');

select public.finish_voice_clip(
  (select id from public.voice_clips where user_id = 'aaaaaaaa-0000-0000-0000-0000000000f1'), 20);
select is((select neurons from public.voice_clips
  where user_id = 'aaaaaaaa-0000-0000-0000-0000000000f1'), 20, 'finish records the real cost');

select public.begin_voice_clip('aaaaaaaa-0000-0000-0000-0000000000f1',
  current_setting('scout.t')::timestamptz) from generate_series(1, 4);
select is(public.begin_voice_clip('aaaaaaaa-0000-0000-0000-0000000000f1',
  current_setting('scout.t')::timestamptz) ->> 'blocked', 'user', 'the sixth clip in 24 hours is refused');
select ok(public.begin_voice_clip('aaaaaaaa-0000-0000-0000-0000000000f1',
  current_setting('scout.t')::timestamptz + interval '25 hours') ? 'id', 'the count rolls over 24 hours');

-- Fill the global budget for the UTC day of scout.t.
insert into public.voice_clips (user_id, neurons, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 9000 - 47 * 5 - 20 + 1, '2030-01-02 00:00:00+00');
select is(public.begin_voice_clip('bbbbbbbb-0000-0000-0000-0000000000f2',
  current_setting('scout.t')::timestamptz) ->> 'blocked', 'global', 'the global budget stops at 9,000 neurons');
select ok(public.begin_voice_clip('bbbbbbbb-0000-0000-0000-0000000000f2',
  '2030-01-03 00:00:01+00'::timestamptz) ? 'id', 'the budget resets at 00:00 UTC');

update public.settings set paused = true;
select is(public.begin_voice_clip('bbbbbbbb-0000-0000-0000-0000000000f2',
  '2030-01-04 00:00:00+00'::timestamptz) ->> 'blocked', 'paused', 'the kill switch stops voice');
update public.settings set paused = false;

select ok(not has_function_privilege('authenticated', 'public.begin_voice_clip(uuid, timestamptz)', 'execute')
  and not has_table_privilege('authenticated', 'public.voice_clips', 'select'),
  'readers cannot call or read voice limits directly');
select ok(has_function_privilege('service_role', 'public.begin_voice_clip(uuid, timestamptz)', 'execute'),
  'the service role can reserve a clip');

select * from finish();
rollback;
