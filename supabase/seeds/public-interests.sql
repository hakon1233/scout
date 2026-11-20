-- The starter catalog: a few public interests anyone can follow, owned by a
-- system account that never signs in. Idempotent: run it again and nothing
-- changes. Not a migration and not applied automatically; run it once by hand
-- on the hosted project (as postgres) when the catalog should go live.
--
-- Public interests run on no one's quota. To let your own account curate more,
-- mark its profile as admin (as postgres):
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = '<your email>');

insert into auth.users (id, email, aud, role)
values ('5c0a7000-0000-4000-8000-000000000001', 'catalog@scout.invalid',
        'authenticated', 'authenticated')
on conflict (id) do nothing;

-- The profile trigger made the profile on first insert; this keeps it admin
-- and the Scout team (profiles.is_team: the team badge, no interest or run
-- caps, and its public topics run only on the team runner).
update public.profiles set is_admin = true, is_team = true
where id = '5c0a7000-0000-4000-8000-000000000001';

insert into public.interests
  (id, owner_id, topic, doc, cadence, run_at, visibility, share_slug)
values
  ('5c0a7000-0000-4000-8000-0000000000a1', '5c0a7000-0000-4000-8000-000000000001',
   'NTNU and Trondheim events',
   'Talks, concerts, festivals and student events in Trondheim for the coming week. '
   'Include NTNU public lectures, Samfundet, Olavshallen and Trondheim kommune '
   'listings. Give the date, place and a link for each. Skip paid conferences.',
   'weekly', '07:00', 'public', 'starter-trondheim-events'),
  ('5c0a7000-0000-4000-8000-0000000000a2', '5c0a7000-0000-4000-8000-000000000001',
   'Nordic grid and power prices',
   'Why Nordic electricity prices move: transmission lines, price areas NO1 to NO5, '
   'hydro reservoir levels, cable exports and regulator decisions (Statnett, NVE, RME). '
   'Primary sources over opinion pieces. Explain each change in one plain sentence.',
   'weekly', '07:00', 'public', 'starter-nordic-power-prices'),
  ('5c0a7000-0000-4000-8000-0000000000a3', '5c0a7000-0000-4000-8000-000000000001',
   'r/LocalLLaMA',
   'The most useful threads this week in the Reddit community r/LocalLLaMA: new open '
   'models, benchmarks people reproduced, and practical guides for running models '
   'on your own hardware. Skip memes and help requests.',
   'weekly', '07:00', 'public', 'starter-r-localllama')
on conflict (id) do nothing;
