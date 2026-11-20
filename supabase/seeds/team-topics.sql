-- The Scout team's 20 test topics (plan/research/team-topics.md, plus five from
-- the tested intent docs below): public, owned by the catalog account, and PAUSED, so the team
-- runner's schedule never runs them (the Worker's cron never runs team topics). Run one by hand with
--   SCOUT_TEAM_RUNNER=on pnpm team:run --only "<topic>"
-- which is a one-off: the topic stays paused.
--
-- Needs supabase/migrations/20261121000000_team_runner.sql (the paused column)
-- and the catalog account from public-interests.sql, which keeps the three
-- starter topics. Not a migration and not applied automatically; run it by
-- hand on the hosted project (as postgres). Idempotent: running it again
-- rewrites each topic's doc and cadence and pauses it again.
--
-- Eight docs are the marketing session's tested ones, copied word for word
-- (docs/public-interests/intent-docs/ on its docs branch, 20 Nov 2026): UK
-- settlement, Bambu Lab, Home Assistant, AtB, Trondheim kids events, AAP,
-- Trondheim council, Norwegian test dates. Their cadence follows its README;
-- "every two weeks" (test dates) is weekly here, as cadence has no such value.
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

People in the UK on a visa route (Skilled Worker, Health and Care, family, Global Talent, BN(O), graduate) who plan to apply for indefinite leave to remain and later citizenship.

## Report

- Statements of changes to the Immigration Rules that touch settlement, qualifying periods, continuous residence, absences, English or Life in the UK
- Earned settlement: rules laid, start dates, transitional protection, guidance for people already on a route
- New or changed caseworker guidance on ILR, long residence or naturalisation
- ILR and naturalisation fee changes
- Court or tribunal rulings that change how settlement rules apply
- Route changes that alter whether time counts toward settlement
- Rules already laid that take effect this week

## Skip

Asylum, small boats, deportation, ETA and visitors, student recruitment, sponsor licence enforcement, unless it changes settlement eligibility. Law-firm marketing and opinion with no new fact. "How to apply" pages.

## Sources, check first

- https://www.gov.uk/search/all?keywords=settlement&organisations%5B%5D=home-office&order=updated-newest (dated list; the date shown is "updated", so take the publish date from the item page)
- https://www.gov.uk/government/collections/immigration-rules-statement-of-changes (newest HC paper first)
- https://freemovement.org.uk/ (analysis; cite gov.uk for the rule itself)

A statement-of-changes page only links PDFs. For its content, fetch Free Movement's write-up or search the HC number; don't spend a fetch on the landing page.

## Search terms

"statement of changes" immigration rules settlement; earned settlement rules laid; indefinite leave to remain changes; qualifying period ILR; HC <number> settlement; naturalisation requirements change

## Each story must state

- Status: consultation / government response / rules laid (HC number) / in force
- Effective date, or "not set"
- Which routes and which people (already on a route vs new entrants)
- Qualifying period before and after, where it changes
- Link to the gov.uk text

## No change

If nothing is new since the last brief, say "No settlement rule changes since <date>." in one line. Don't pad with older law-firm summaries.

## Language and place

English. United Kingdom, Europe/London. Use the readers' words: ILR, settlement, qualifying period, route.$doc$,
   'weekly', '07:00', 'public', 'team-uk-settlement-ilr-rules', true),

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
$doc$# Bambu Lab firmware and policy changes

## Reader

Owners of Bambu Lab printers (A1, P1, P2, X1, H2, H3, X2 series) who want to know what an update changes before they install it, and when Bambu changes how their printer connects.

## Report

- Firmware for any Bambu printer or AMS, stable or official public beta: version, models, what changes, security fixes, known issues
- Changes to authorization, LAN-only or developer mode, cloud service, Bambu Connect, or third-party access (Orca Slicer, Home Assistant)
- Bambu Studio or Bambu Handy releases that change printer control, firmware requirements, cloud or security
- Cloud outages and postmortems, data or privacy incidents
- Recalls, service notices, safety notices, warranty or terms changes
- A firmware problem only when Bambu staff confirm it or pull the update

## Skip

New printer, filament and accessory launches; sales; MakerWorld contests and merch; events; user stories; help threads; one user's report of a bad update; review sites.

## Sources, check first

- https://forum.bambulab.com/c/announcements/10.rss (official announcements, dated)
- https://forum.bambulab.com/c/bambu-lab-p/101.rss, https://forum.bambulab.com/c/bambu-lab-a-series/149.rss, https://forum.bambulab.com/c/bambu-lab-h2-series/166.rss (staff firmware posts by "SupportAssistant")
- https://github.com/bambulab/BambuStudio/releases

wiki.bambulab.com refuses the fetch tool; use its pages only through search snippets. Don't guess forum topic URLs; take them from the feeds.

## Search terms

Bambu Lab firmware public beta; Bambu Lab firmware release notes <model>; Bambu Lab cloud outage; Bambu Connect; Bambu Lab third-party access; Bambu Lab recall service notice

## Each story must state

- Models affected
- Firmware or app version, and stable or beta
- Release date (from the post, or the YYYYMMDD in a version heading)
- What changes for owners, and anything they must do first (e.g. bridge firmware)
- Link to Bambu's own post or release page

## No change

If nothing is new since the last brief, say "No firmware or policy changes since <date>." Don't pad with launches.

## Language and place

English sources and output. Worldwide, UTC.$doc$,
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

People who run Home Assistant themselves and want to know what an update will break, and what to do, before they install it.

## Report

- The monthly release's backward-incompatible changes, once, in the week it ships: how many integrations, then the ones most users run, each in one line with what to do
- Patch releases (x.y.1, x.y.2 …) that fix regressions, carry security fixes or change behaviour
- Integrations removed or disabled; install methods, platforms or apps losing support
- Security advisories, with severity, CVE and fixed version
- Contributor blog deprecations that will break custom integrations, HACS or apps, with the release they land in
- The coming release's beta notes, once the beta starts

## Skip

New features, dashboards and design, Works with Home Assistant partner news, community events, podcasts, hardware sales, how-to guides, forum help threads, third-party "what's new" posts.

## Sources, check first

- https://github.com/home-assistant/core/releases (patch notes, compact and dated)
- https://contributors.home-assistant.io/blog/ (deprecations; the old developers.home-assistant.io address redirects here)
- https://www.home-assistant.io/security/ (advisories, newest first)
- https://www.home-assistant.io/blog/ (release posts and announcements)

A monthly release post is over 200,000 characters; its backward-incompatible section is near the end and won't fit one fetch. Search "Home Assistant <version> backward-incompatible <integration>" instead, and link the post with #backward-incompatible-changes.

## Search terms

Home Assistant <version> backward-incompatible; Home Assistant integration removed; Home Assistant deprecation <version>; Home Assistant security advisory CVE; Home Assistant <next version> beta

## Each story must state

- Version and release date
- Who is affected: integration, install type (OS, Container, Supervised, Core) or app
- What breaks or changes, and what to do before updating
- For deprecations, the release where it stops working
- Link to the official release, advisory or blog post

## No change

If there is no new release, advisory or deprecation since the last brief, say "No breaking changes since <version, date>." Don't repeat the monthly release in later weeks.

## Language and place

English. Worldwide, UTC.$doc$,
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
   'weekly', '07:00', 'public', 'team-trondheim-student-events', true),

  ('5c0a7000-0000-4000-8000-000000000116', '5c0a7000-0000-4000-8000-000000000001',
   'AtB bus route changes in Trondheim',
$doc$# AtB bus route changes in Trondheim

## Reader

People in Trondheim who ride AtB buses and trams and need to know today which stops are closed and which lines take a detour.

## Report

- A stop closed or moved (holdeplass stengt / flyttet), with lines affected
- A line on a detour (omkjøring, avvikende trasé) or ending early
- Night or weekend closures for road work, in the coming 7 days
- A change to an existing detour (new end date, stop served again)
- AtB's own notice of new timetables or a changed route network

## Skip

- Delays and cancelled single departures caused by traffic or weather
- Boat, ferry and regional lines outside Trondheim, Malvik, Melhus, Stjørdal and Skaun
- Ticket prices, app news, surveys, jobs
- Notices with no change since the last brief

## Sources, check first

- https://www.atb.no/driftsmeldinger/ : one page with every current notice and its "Publisert" and "Oppdatert" dates. Read this first; it is enough on most days.
- https://www.atb.no/driftsmeldinger-rss/ : the 5 newest notices, each with its own link and pubDate.
- https://www.atb.no/nyheter-fra-atb-rss/ : AtB news; only items about routes or timetables count.

A notice's own page (atb.no/driftsavvik/buss-og-trikk/...) has no date. Take the date from the list page or the RSS feed, and link the notice's own page.

## Search terms

AtB omkjøring, holdeplass stengt Trondheim, AtB nye rutetider, AtB driftsmelding

## Each story must state

- The date in backticks: the notice's "Oppdatert" date (or "Publisert" if not updated)
- Lines affected and stops closed or moved
- When it starts and ends (or "varighet ukjent"), with times for night work
- What to use instead (the other stop or line AtB names)
- Link to the notice on atb.no

## No change

This runs daily. Report only notices published or updated in the last 3 days. If there are none, write one line: "No new AtB changes since <date of newest notice>." Don't repeat older notices.

## Language and place

Read Norwegian sources, write in English. Keep stop and street names in Norwegian. Trondheim, Europe/Oslo.$doc$,
   'daily', '07:00', 'public', 'team-atb-bus-route-changes-trondheim', true),

  ('5c0a7000-0000-4000-8000-000000000117', '5c0a7000-0000-4000-8000-000000000001',
   'Trondheim kids and family events this week',
$doc$# Trondheim kids and family events this week

## Reader

Parents in Trondheim with children aged 0–12 who want a short list of good, one-off things to do in the next 7 days.

## Report

Each story is one event page. Pick up to 4, in this order:

- One-off events (one date, or a few dates in a single weekend)
- Free events (gratis) before paid ones
- A new show's opening weekend, or a seasonal event (Christmas workshop, holiday programme)
- Events that need booking, so parents can act in time

## Skip

- Weekly or "every weekend" offers (open hours at a museum, baby play groups, swim or skating schools)
- Shows with many dates already reported in an earlier brief
- Events for adults only, and events outside Trondheim
- The listing page itself: it only points to events

## Sources, check first

- https://trdevents.no/category/barn-familie : family events, soonest first. Server-rendered list shows only the next one or two days; follow its event links.
- https://trdevents.no/ : the front page highlights bigger events later in the week; keep the ones for children.
- https://litteraturhusetitrondheim.no/program : talks and readings for children (Barnas Basta).

Open each event page (trdevents.no/arrangement/...) before you report it: it states the date, time, venue, age, price and booking link.

## Search terms

barn og familie Trondheim helg, gratis for barn Trondheim, familieforestilling Trondheim, juleverksted Trondheim

## Each story must state

- The date in backticks: the EVENT date (not a publish date); for a run of dates, the first date in the coming 7 days
- Time and venue
- Age group, if given
- Price or "free"
- Booking: needed or not, where, and any deadline
- Link to the event page

## No change

There is almost always something. If no one-off event for children is listed in the next 7 days, write one line: "No one-off family events found for <dates>." Don't fill with weekly offers.

## Language and place

Read Norwegian sources, write in English. Keep event titles in Norwegian. Trondheim, Europe/Oslo.$doc$,
   'weekly', '07:00', 'public', 'team-trondheim-kids-family-events', true),

  ('5c0a7000-0000-4000-8000-000000000118', '5c0a7000-0000-4000-8000-000000000001',
   'AAP, sykepenger og uføretrygd',
$doc$# AAP, sykepenger og uføretrygd: regelendringer

## Reader

People in Norway on arbeidsavklaringspenger (AAP), or on sykepenger on the way to AAP, or moving from AAP to uføretrygd, who need to know when the rules for their money or duties change.

## Report

Lead with AAP. Then sykepenger and uføretrygd, only where the change reaches the person who is ill.

- Proposed or adopted rule changes: høring, Prop. L to Stortinget, Stortinget vote, new forskrift
- Changes to rates, grunnbeløpet (G), barnetillegg or payment rules
- New NAV practice for AAP: changed rundskriv text for folketrygdloven kapittel 11, meldekort or activity duties
- Trygderetten, court, Sivilombudet or Riksrevisjonen findings that change how NAV must handle these cases
- Statsbudsjett and budget-deal changes to these benefits

## Skip

- Changes that only affect employers (refusjon, inntektsmelding)
- Outreach campaigns and pilots with no rule change
- Statistics, labour-market numbers, analyses
- Dagpenger, pensjon, barnetrygd, sosialhjelp
- Opinion pieces and personal stories
- NAV service pages ("slik søker du") and nav.no/regelendringer-<år> (only updated at New Year)

## Sources, check first

- https://www.regjeringen.no/no/dep/aid/id165/ (the department's news and pressemeldinger, dated)
- https://www.regjeringen.no/no/dokument/hoyringar/id1763/?ownerid=165 (its høringer, with frist and status)
- https://www.nav.no/samarbeidspartner/presse (NAV press releases)
- https://lovdata.no/nav/rundskriv/r11-00 (AAP rundskriv; "Sist endret" shows new practice)

## Search terms

arbeidsavklaringspenger endring; AAP høring; AAP forskrift; sykepenger uføretrygd forslag; Prop. L folketrygdloven <session, e.g. 2026–2027>; Trygderetten AAP; statsbudsjettet AAP

## Each story must state

- Status: på høring (with frist) / sendt Stortinget (Prop. number) / vedtatt / i kraft. A pressemelding often doesn't say; check the høring page for the same topic, or write "status ikke oppgitt". Never guess.
- Ikrafttredelse, or "ikke fastsatt"
- Who it affects (e.g. AAP under 25, full uføretrygd with work income)
- What changes, in kroner or G where given
- Link to the official text (regjeringen.no, stortinget.no, lovdata.no or nav.no)

## No change

If there is no new AAP rule, the first line says "Ingen nye AAP-regler siden <dato>." Then list sykepenger or uføretrygd stories, if any. Don't pad.

## Language and place

Read Norwegian (bokmål and nynorsk). Write in Norwegian bokmål. Norway, Europe/Oslo.$doc$,
   'weekly', '07:00', 'public', 'team-aap-sykepenger-uforetrygd', true),

  ('5c0a7000-0000-4000-8000-000000000119', '5c0a7000-0000-4000-8000-000000000001',
   'Trondheim council decisions on housing, parking and roads',
$doc$# Trondheim council decisions on housing, parking and roads

## Reader

Trondheim residents, homeowners and builders who want to know what the city decided or proposed this week on new homes, parking and streets, and when they can object.

## Report

- Bystyret, byrådet or bygningsrådet approving or rejecting a zoning plan (reguleringsplan) for homes
- A plan put out for public comment (offentlig ettersyn), with the deadline
- An adopted plan announced with an appeal deadline (klagefrist)
- Decisions on parking: beboerparkering zones, P-avgift, parking norms in plans
- Decisions on streets and roads: speed limits, bike lanes, car-free streets, Miljøpakken projects
- Housing policy: boligpolitisk plan, rules for short-term rental, social housing

## Skip

- Acute road closures and dig work (gravearbeid) with no political decision
- Budget news unless it names a housing, parking or road item
- Schools, health, culture, events
- Opinion pieces and reader letters

## Sources, check first

- https://www.trondheim.kommune.no/aktuelt/kunngjoring-arealplan/ : plans out for comment and adopted plans, each with its deadline. Open a plan's own page for the decision date and documents.
- https://www.trondheim.kommune.no/aktuelt/nyheter/ : the city's news, including "Les sakene fra byrådet <date>" each week.
- https://www.adressa.no/nyheter/trondheim : Adresseavisen's Trondheim news, with time stamps. Articles are paywalled: use a headline to find the decision, then look for the city's own page or document. If none is found, cite Adressa and say "paywalled, details unconfirmed".
- https://www.nrk.no/trondelag/ : NRK Trøndelag, free to read.

## Search terms

bystyret Trondheim boliger, sa ja til boliger Trondheim, reguleringsplan Trondheim vedtatt, beboerparkering Trondheim, fartsgrense Trondheim kommune, Miljøpakken vedtak

## Each story must state

- Status: proposed, out for comment, adopted, or rejected
- Which body decided (bystyret, byrådet, bygningsrådet) and the date
- Place and size (street, number of homes, what changes for parking or traffic)
- The deadline to comment or appeal, if any
- Link to the city's page or document when it exists

## No change

If nothing was decided or put out for comment in the last 7 days, write one line: "No new council decisions on housing, parking or roads since <date>." Don't pad with older plans.

## Language and place

Read Norwegian sources, write in English. Keep place and body names in Norwegian. Trondheim, Europe/Oslo.$doc$,
   'weekly', '07:00', 'public', 'team-trondheim-council-decisions', true),

  ('5c0a7000-0000-4000-8000-000000000120', '5c0a7000-0000-4000-8000-000000000001',
   'Norwegian test dates',
$doc$# Norskprøven, Bergenstest and samfunnskunnskap: dates and deadlines

## Reader

Adults in Trondheim preparing for a Norwegian test or the social studies or citizenship test, who must not miss a registration window.

## Report

- A registration window (påmeldingsperiode) that opens or closes in the next 30 days
- A test period starting in the next 14 days, and when results come
- A new or changed date in the official schedule
- Changes to the tests or how to register (new test system, fees, ID checks)
- Rule changes about which test level is needed for permanent residence or citizenship (UDI, regjeringen)

## Skip

- Course ads, practice-test sites and private schools' blog posts
- Tests abroad
- Dates more than 30 days away, unless the schedule itself changed

## Sources, check first

- https://prove.hkdir.no/norskprove-a1-b2/nar-er-proven-norsk-a1-b2 : the national Norskprøve A1–B2 schedule: registration, test period, results, appeal deadline.
- https://prove.hkdir.no/ : HK-dir notices about the tests (top of page).
- https://prove.hkdir.no/samfunnskunnskapsprove/meld-deg-pa-samfunnskunnnskap : how to register. Dates for samfunnskunnskap and statsborgerprøve are set by each test site in a login portal; Scout can't read them. Say so; don't guess.
- https://www.folkeuniversitetet.no/bergenstesten : Bergenstesten (B2/C1) dates and deadline, held in Oslo, Bergen and Stavanger. The page is long; the dates are under "Kommende testdatoer".
- https://www.udi.no/sok/?filter=press : UDI news, dated, for rule changes.

## Search terms

norskprøve påmelding, Bergenstesten testdato, samfunnskunnskapsprøve Trondheim, statsborgerprøve påmelding, HK-dir nytt prøvesystem, UDI krav norsk permanent opphold

## Each story must state

- The date in backticks: the next deadline or test day (for a rule change, the date it was published)
- Which test and level
- Registration window, test period, result date
- Where to register (link to the official page)
- For a rule change: status (proposed / adopted) and the date it applies from

## No change

The schedule changes a few times a year. If no window opens or closes in the next 30 days, no test starts in the next 14 days and nothing changed, write one line: "No new test dates or rule changes; next Norskprøve registration: <dates>." Don't repeat the full schedule.

## Language and place

Read Norwegian sources, write in English, simple words (many readers are learning Norwegian). Norway, test sites in Trondheim. Europe/Oslo.$doc$,
   'weekly', '07:00', 'public', 'team-norwegian-test-dates-deadlines', true)
on conflict (id) do update
  set topic = excluded.topic,
      doc = excluded.doc,
      cadence = excluded.cadence,
      visibility = excluded.visibility,
      paused = true;

-- A weekend brief: Trondheim kids and family events runs on Fridays.
update public.interests set run_weekday = 5
where id = '5c0a7000-0000-4000-8000-000000000117';

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
        ('5c0a7000-0000-4000-8000-000000000115'::uuid, array['local','nordic','events']),
        ('5c0a7000-0000-4000-8000-000000000116'::uuid, array['local','nordic','travel']),
        ('5c0a7000-0000-4000-8000-000000000117'::uuid, array['local','nordic','events','family']),
        ('5c0a7000-0000-4000-8000-000000000118'::uuid, array['benefits','nordic','work']),
        ('5c0a7000-0000-4000-8000-000000000119'::uuid, array['local','nordic','housing','regulation']),
        ('5c0a7000-0000-4000-8000-000000000120'::uuid, array['language','immigration','nordic'])
      ) as t(id, tags)
      where i.id = t.id
    $sql$;
  end if;
end
$$;
