-- The Scout team's test topics (plan/research/team-topics.md): public, owned by
-- the catalog account, and PAUSED, so neither the Worker's cron nor the team
-- runner's schedule ever runs them. Run one by hand with
--   SCOUT_TEAM_RUNNER=on pnpm team:run --only "<topic>"
-- which is a one-off: the topic stays paused.
--
-- Needs supabase/migrations/20261121000000_team_runner.sql (the paused column)
-- and the catalog account from public-interests.sql, which keeps the three
-- starter topics. Not a migration and not applied automatically; run it by
-- hand on the hosted project (as postgres). Idempotent: running it again
-- rewrites each topic's doc and cadence and pauses it again.
--
-- Intent docs avoid the words that opt a topic out of the freshness cutoff
-- (EVERGREEN_RE in packages/core/src/coverage.ts).

insert into public.interests
  (id, owner_id, topic, doc, cadence, run_at, visibility, share_slug, paused)
values
  ('5c0a7000-0000-4000-8000-000000000101', '5c0a7000-0000-4000-8000-000000000001',
   'UK settlement (ILR) rule changes',
$doc$# UK settlement (ILR) rule changes
## Reader
Someone on a UK work or family visa planning to apply for indefinite leave to remain.
## Report
Changes to settlement rules, qualifying periods, English and Life in the UK requirements, fees, and published processing times.
## Skip
Opinion pieces, law-firm marketing, and individual case stories.
## Sources, check first
- https://www.gov.uk/government/collections/immigration-rules-statement-of-changes
- https://www.gov.uk/settle-in-the-uk
- https://www.gov.uk/guidance/visa-processing-times-applications-inside-the-uk
- https://www.gov.uk/government/organisations/uk-visas-and-immigration
## Search terms
statement of changes immigration rules, indefinite leave to remain changes, settlement qualifying period, ILR fee
## Each story must state
What changed, its status (proposed, laid before Parliament, in force), the effective date, who it affects, and a link to the official text.
## No change
If nothing new, say so, don't pad.
## Language and place
English. United Kingdom.$doc$,
   'daily', '07:00', 'public', 'team-uk-settlement-ilr-rules', true),

  ('5c0a7000-0000-4000-8000-000000000102', '5c0a7000-0000-4000-8000-000000000001',
   'Canada immigration processing',
$doc$# Canada immigration processing
## Reader
Someone applying for Canadian permanent residence or a work permit.
## Report
IRCC processing-time updates, Express Entry draws (type, size, cut-off score), and policy changes.
## Skip
Consultant advertising and forum rumours.
## Sources, check first
- https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html
- https://www.canada.ca/en/immigration-refugees-citizenship/corporate/mandate/policies-operational-instructions-agreements/ministerial-instructions/express-entry-rounds.html
- https://www.canada.ca/en/immigration-refugees-citizenship/news.html
## Search terms
Express Entry draw, IRCC processing times, IRCC policy change
## Each story must state
What changed, its status, the effective date, who it affects, and a link to the official text.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Canada.$doc$,
   'weekly', '07:00', 'public', 'team-canada-immigration-processing', true),

  ('5c0a7000-0000-4000-8000-000000000103', '5c0a7000-0000-4000-8000-000000000001',
   'Swedish work permits and citizenship',
$doc$# Swedish work permits and citizenship
## Reader
Someone working in Sweden on a permit, or planning to apply for citizenship.
## Report
Migrationsverket rule changes, waiting times, new requirements (salary floor, language and civics tests), and bills in the Riksdag.
## Skip
Asylum statistics and political commentary without a rule change.
## Sources, check first
- https://www.migrationsverket.se/
- https://www.regeringen.se/
- https://www.riksdagen.se/
## Search terms (in Swedish)
arbetstillstånd nya regler, medborgarskap krav, Migrationsverket handläggningstid, försörjningskrav
## Each story must state
What changed, its status (proposal, bill, in force), the effective date, who it affects, and a link to the official text.
## No change
If nothing new, say so, don't pad.
## Language and place
Write in English; Swedish sources. Sweden.$doc$,
   'weekly', '07:00', 'public', 'team-sweden-work-permits-citizenship', true),

  ('5c0a7000-0000-4000-8000-000000000104', '5c0a7000-0000-4000-8000-000000000001',
   'Drone rules (DJI, FAA, EASA)',
$doc$# Drone rules (DJI, FAA, EASA)
## Reader
A hobby or commercial drone pilot in the US or Europe.
## Report
DJI import and ban news, FAA and EASA rule changes (Remote ID, categories, registration), and firmware that changes flight limits.
## Skip
Product reviews and new-model rumours.
## Sources, check first
- https://www.faa.gov/uas
- https://www.easa.europa.eu/en/domains/civil-drones
- https://www.dji.com/newsroom
- https://www.federalregister.gov/
## Search terms
FAA drone rule, EASA drone regulation, DJI ban, DJI firmware geofencing
## Each story must state
What changed, its status, the effective date, who it affects, and a link to the official text.
## No change
If nothing new, say so, don't pad.
## Language and place
English. United States and the EU.$doc$,
   'weekly', '07:00', 'public', 'team-drone-rules-dji-faa-easa', true),

  ('5c0a7000-0000-4000-8000-000000000105', '5c0a7000-0000-4000-8000-000000000001',
   'Bambu Lab firmware and policy',
$doc$# Bambu Lab firmware and policy
## Reader
Someone who owns a Bambu Lab 3D printer.
## Report
Firmware releases, authorisation and cloud-policy changes, and notable bugs or recalls.
## Skip
Print showcases and buying guides.
## Sources, check first
- https://wiki.bambulab.com/en/release-notes
- https://blog.bambulab.com/
- https://forum.bambulab.com/
## Search terms
Bambu Lab firmware update, Bambu Lab authorization, Bambu Lab recall
## Each story must state
What changed, the firmware version or policy, the date, which printers it affects, and a link to the official notes.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'weekly', '07:00', 'public', 'team-bambu-lab-firmware-policy', true),

  ('5c0a7000-0000-4000-8000-000000000106', '5c0a7000-0000-4000-8000-000000000001',
   'Open-source relicensing and rug-pulls',
$doc$# Open-source relicensing and rug-pulls
## Reader
A developer or self-hoster who depends on open-source tools.
## Report
Licence changes, community forks that follow, and shutdowns or paywalls of self-hosted tools.
## Skip
Licence debates with no project changing anything.
## Sources, check first
- https://opensource.org/blog
- https://lwn.net/
- https://github.blog/
## Search terms
relicense, license change BSL, open source fork, self-hosted shutdown
## Each story must state
Which project, the old and new licence or the change, the effective date, who it affects, and a link to the announcement.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'weekly', '07:00', 'public', 'team-open-source-relicensing', true),

  ('5c0a7000-0000-4000-8000-000000000107', '5c0a7000-0000-4000-8000-000000000001',
   'Climbing competitions and access',
$doc$# Climbing competitions and access
## Reader
A climber who follows competitions and climbs outdoors.
## Report
IFSC and national results and schedules, and crag access closures and reopenings.
## Skip
Gear reviews and training tips.
## Sources, check first
- https://www.ifsc-climbing.org/
- https://www.accessfund.org/
- https://www.thebmc.co.uk/
## Search terms
IFSC results, climbing world cup schedule, crag closure, climbing access
## Each story must state
What happened, the date, where, who it affects, and a link to the official source.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'weekly', '07:00', 'public', 'team-climbing-competitions-access', true),

  ('5c0a7000-0000-4000-8000-000000000108', '5c0a7000-0000-4000-8000-000000000001',
   'LLM releases, prices and retirements',
$doc$# LLM releases, prices and retirements
## Reader
A developer who builds on hosted LLM APIs.
## Report
New models, price changes, and deprecation or retirement dates from the main vendors.
## Skip
Benchmark hype, leaks and rumours.
## Sources, check first
- https://docs.anthropic.com/en/docs/about-claude/model-deprecations
- https://platform.openai.com/docs/deprecations
- https://ai.google.dev/gemini-api/docs/changelog
- https://docs.mistral.ai/getting-started/changelog/
## Search terms
model deprecation, API price change, new model release
## Each story must state
Which vendor and model, what changed, the effective or retirement date, who it affects, and a link to the vendor's page.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'daily', '07:00', 'public', 'team-llm-releases-prices-retirements', true),

  ('5c0a7000-0000-4000-8000-000000000109', '5c0a7000-0000-4000-8000-000000000001',
   'Home Assistant breaking changes',
$doc$# Home Assistant breaking changes
## Reader
Someone who runs Home Assistant at home.
## Report
Breaking changes and removed integrations in each release.
## Skip
New-feature highlights that need no action.
## Sources, check first
- https://www.home-assistant.io/blog/
- https://github.com/home-assistant/core/releases
- https://developers.home-assistant.io/blog/
## Search terms
Home Assistant breaking changes, integration removed
## Each story must state
The release, what breaks, who it affects, what to do, and a link to the release notes.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'weekly', '07:00', 'public', 'team-home-assistant-breaking-changes', true),

  ('5c0a7000-0000-4000-8000-000000000110', '5c0a7000-0000-4000-8000-000000000001',
   'EU entry rules (EES / ETIAS)',
$doc$# EU entry rules (EES / ETIAS)
## Reader
A non-EU traveller visiting the Schengen area.
## Report
EES and ETIAS rollout dates, entry-rule changes, and what travellers must do.
## Skip
Travel-agency advertising.
## Sources, check first
- https://travel-europe.europa.eu/ees_en
- https://travel-europe.europa.eu/etias_en
- https://home-affairs.ec.europa.eu/
## Search terms
EES rollout, ETIAS start date, Schengen entry rules
## Each story must state
What changed, its status, the effective date, who it affects, and a link to the official text.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Schengen area.$doc$,
   'weekly', '07:00', 'public', 'team-eu-entry-rules-ees-etias', true),

  ('5c0a7000-0000-4000-8000-000000000111', '5c0a7000-0000-4000-8000-000000000001',
   'Norway UDI waiting times and rules',
$doc$# Norway UDI waiting times and rules
## Reader
Someone in Norway on a permit, or applying for permanent residence or citizenship.
## Report
UDI processing times, and permit and citizenship rule changes.
## Skip
Asylum statistics and political commentary without a rule change.
## Sources, check first
- https://www.udi.no/
- https://www.udi.no/ventetider/
- https://www.regjeringen.no/
- https://lovdata.no/
## Search terms (in Norwegian)
UDI ventetid, nye regler oppholdstillatelse, statsborgerskap krav, permanent opphold endring
## Each story must state
What changed, its status (consultation, decided, in force), the effective date, who it affects, and a link to the official text.
## No change
If nothing new, say so, don't pad.
## Language and place
Write in English; Norwegian sources. Norway.$doc$,
   'weekly', '07:00', 'public', 'team-norway-udi-waiting-times-rules', true),

  ('5c0a7000-0000-4000-8000-000000000112', '5c0a7000-0000-4000-8000-000000000001',
   'npm and PyPI supply-chain attacks',
$doc$# npm and PyPI supply-chain attacks
## Reader
A developer who installs packages from npm or PyPI.
## Report
Malicious or compromised packages, and what to do about them.
## Skip
Vendor marketing and generic security advice.
## Sources, check first
- https://github.com/advisories
- https://socket.dev/blog
- https://blog.pypi.org/
- https://github.blog/security/
## Search terms
malicious npm package, compromised PyPI package, supply chain attack
## Each story must state
Which packages and versions, when, who it affects, what to do, and a link to the advisory.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'daily', '07:00', 'public', 'team-npm-pypi-supply-chain-attacks', true),

  ('5c0a7000-0000-4000-8000-000000000113', '5c0a7000-0000-4000-8000-000000000001',
   'Emulator releases',
$doc$# Emulator releases
## Reader
Someone who plays games on emulators.
## Report
Major releases, legal takedowns, and compatibility milestones.
## Skip
Where to download games.
## Sources, check first
- https://dolphin-emu.org/blog/
- https://rpcs3.net/blog/
- https://www.libretro.com/index.php/category/blog/
- https://pcsx2.net/blog/
## Search terms
emulator release, emulator takedown, emulator compatibility
## Each story must state
Which emulator and version, the date, what changed, who it affects, and a link to the release notes.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'weekly', '07:00', 'public', 'team-emulator-releases-news', true),

  ('5c0a7000-0000-4000-8000-000000000114', '5c0a7000-0000-4000-8000-000000000001',
   'TCG ban lists and set releases',
$doc$# TCG ban lists and set releases
## Reader
A Magic, Pokémon or Lorcana player.
## Report
Banned and restricted announcements, and set release dates.
## Skip
Deck guides and card prices.
## Sources, check first
- https://magic.wizards.com/en/news
- https://www.pokemon.com/us/pokemon-news
- https://www.disneylorcana.com/en-US/news
## Search terms
banned and restricted announcement, set release date
## Each story must state
Which game and format, what changed, the effective date, who it affects, and a link to the official announcement.
## No change
If nothing new, say so, don't pad.
## Language and place
English. Worldwide.$doc$,
   'weekly', '07:00', 'public', 'team-tcg-ban-lists-set-releases', true),

  ('5c0a7000-0000-4000-8000-000000000115', '5c0a7000-0000-4000-8000-000000000001',
   'Trondheim student events this week',
$doc$# Trondheim student events this week
## Reader
A student in Trondheim.
## Report
Open student events in the coming week: Samfundet, TIHLDE, Abakus, Start NTNU, ISFiT, UKA.
## Skip
Members-only events and paid conferences.
## Sources, check first
- https://www.samfundet.no/arrangement
- https://tihlde.org/arrangementer/
- https://abakus.no/events
- https://www.startntnu.no/
## Search terms (in Norwegian)
arrangement Trondheim studenter, Samfundet program, denne uken
## Each story must state
The event, the date and time, the place, who may come, and a link.
## No change
If nothing new, say so, don't pad.
## Language and place
Write in English; Norwegian sources. Trondheim, Norway.$doc$,
   'weekly', '07:00', 'public', 'team-trondheim-student-events', true)
on conflict (id) do update
  set topic = excluded.topic,
      doc = excluded.doc,
      cadence = excluded.cadence,
      visibility = excluded.visibility,
      paused = true;

-- Tags are data for the catalog; applied only once interests has a tags column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interests' and column_name = 'tags'
  ) then
    execute $sql$
      update public.interests i set tags = t.tags
      from (values
        ('5c0a7000-0000-4000-8000-000000000101'::uuid, array['immigration','uk','work']),
        ('5c0a7000-0000-4000-8000-000000000102'::uuid, array['immigration','canada','work']),
        ('5c0a7000-0000-4000-8000-000000000103'::uuid, array['immigration','nordic','work']),
        ('5c0a7000-0000-4000-8000-000000000104'::uuid, array['hardware','regulation','maker']),
        ('5c0a7000-0000-4000-8000-000000000105'::uuid, array['hardware','maker','platform-policy']),
        ('5c0a7000-0000-4000-8000-000000000106'::uuid, array['open-source','self-hosting','dev-tools']),
        ('5c0a7000-0000-4000-8000-000000000107'::uuid, array['sports','outdoors']),
        ('5c0a7000-0000-4000-8000-000000000108'::uuid, array['ai','dev-tools']),
        ('5c0a7000-0000-4000-8000-000000000109'::uuid, array['smart-home','self-hosting','open-source']),
        ('5c0a7000-0000-4000-8000-000000000110'::uuid, array['travel','regulation','immigration']),
        ('5c0a7000-0000-4000-8000-000000000111'::uuid, array['immigration','nordic']),
        ('5c0a7000-0000-4000-8000-000000000112'::uuid, array['security','dev-tools','open-source']),
        ('5c0a7000-0000-4000-8000-000000000113'::uuid, array['gaming','retro','open-source']),
        ('5c0a7000-0000-4000-8000-000000000114'::uuid, array['games-tabletop','collectibles']),
        ('5c0a7000-0000-4000-8000-000000000115'::uuid, array['local','nordic','events'])
      ) as t(id, tags)
      where i.id = t.id
    $sql$;
  end if;
end
$$;
