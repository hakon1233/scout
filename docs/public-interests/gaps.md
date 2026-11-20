# Gaps: what the use-case research missed

An adversarial pass over `use-cases.md`, `business-more.md` and the place docs, looking
through seven lenses: life events, organisations, senses and data types, emotions and
motives, skipped places, inversions, and adjacent products (Google Alerts, IFTTT,
Visualping, F5Bot, changedetection.io, Feedly AI, Particle, Perplexity). It took three
rounds, all on 20 Nov 2026, and round 3 found only near-duplicates.

✓ = fetched and readable with WebFetch on 20 Nov; ~ = partly readable (dated news yes,
tables JavaScript); ✗ = blocked, JavaScript-only or undated. Score 1–5 = need × how
badly it is served today.

## What was missing

The existing docs cover life roles well, but three kinds of need are thin:

- **Fear and safety, not a role.** Scams aimed at parents, strikes that shut schools or
  flights, and animal-disease zones were missing. People watch these out of worry, not
  as part of a job.
- **Inversions.** A promised date slipping, a source going quiet, my own name in public
  records, and a claim window closing. None of these were watch types.
- **Land use.** Wind, power-line, hydro and mining concessions near a home or cabin.
  Radius watch covers planning applications, but not these state-level cases.

The adjacent products confirm this. Visualping's self-reported uses are price (40%,
excluded), government and regulatory pages (13%), restock, jobs at named firms, release
notes, court filings, SEO and defacement. Feedly AI's models cover leadership changes,
funding, M&A, launches, regulation and exploits. Both are already covered here, apart
from the new rows below.

## New watch types

| Watch type               | Principle                                                | Example                                                       | Score |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- | ----- |
| Slip watch               | A promised date or pledge: say when it slips, or is kept | E6 section opening; a game's release date; a party pledge     | 3–4   |
| Claim window             | Money I may be owed, and the date the claim closes       | Class-action settlements; compensation schemes; disaster aid  | 3–4   |
| Report-card watch        | A new inspection result for one named institution        | Care home, kindergarten, school (Ofsted, CQC, Helsetilsynet)  | 3     |
| Peer-practice watch      | What organisations like mine did about X                 | How other kommuner handled school phone bans                  | 3     |
| Gone quiet               | A regular signal stops: no release, no post, no update   | An open-source project or game studio goes silent             | 3     |
| Myself in public records | My own name, company or property shows up in a record    | New roles registered on my company (brreg); a lien on my home | 2–3   |

"All-clear" (a fire ban, boil-water notice or strike ends) is a near-duplicate of _Wait
for an event_. It belongs in that row's examples, not as a new type.

## New groups

| Group                                     | Watch                                                  | Example topic                                   | Source                                   | Score |
| ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------- | ----- |
| Commuters and parents                     | Strikes that could hit me, with the mediation deadline | "Will a strike close kindergartens or flights?" | Riksmekleren ✓ (parties and deadlines)   | 4     |
| Grown children of older parents           | New scams in Norway this week                          | "Scams aimed at my parents' age group"          | Finanstilsynet warnings ✓, bank pages    | 4     |
| Rural residents, cabin owners, Sámi       | Energy and land concessions near me                    | "Wind, power line or hydro cases in Tydal"      | NVE news ~ (case table is JavaScript)    | 3–4   |
| Off-plan home buyers, builder customers   | My developer's or builder's solvency                   | "Is my new-build developer in trouble?"         | brreg ✓; news                            | 3–4   |
| US consumers                              | Class-action claim deadlines                           | "Open settlements I may qualify for"            | topclassactions ✓ (sorted by deadline)   | 3–4   |
| Poultry keepers, beekeepers, horse owners | Animal-disease zones                                   | "Bird-flu zones in Trøndelag"                   | Mattilsynet ✓ (zones undated)            | 3     |
| Cross-border commuters, travellers        | Internal Schengen border controls                      | "NO/SE/DK checks, 12 Nov 2026 – 11 May 2027"    | EU Commission list ✓                     | 3     |
| Holders of weak passports                 | Visa-free list changes for my passport                 | "Countries added or lost for Indian passports"  | News ✓                                   | 3     |
| Genealogists                              | New digitised records for my parishes and surnames     | "New Norwegian church records"                  | FamilySearch monthly ✓; Digitalarkivet ✗ | 3     |
| Exporters, compliance staff               | Sanctions and export-control changes                   | "New Russia sanctions that touch my goods"      | OFAC ✓; EU news                          | 3     |
| Sport shooters, gun owners                | Gun-law hearings and changes                           | "Magazine rules for sport shooters"             | regjeringen.no ✓; jeger.no               | 3     |
| US disaster-hit households                | Disaster declarations and aid deadlines                | "FEMA aid deadline for my county"               | OpenFEMA API ✓                           | 3     |
| Voters                                    | Candidate lists and programmes before an election      | "Kommunevalg 2027 in Trondheim"                 | Party and kommune pages, news            | 3     |
| B2B salespeople                           | Trigger events at prospects                            | "New CEO or funding at my top 20 accounts"      | brreg ✓; news                            | 3     |
| Data analysts, journalists                | Releases due from the statistics office                | "SSB releases next week in my field"            | ssb.no/kalender ✓                        | 2–3   |
| US recruiters, at-risk workers            | WARN layoff notices                                    | "Layoff notices in my county"                   | State pages ~ (XLSX); paid trackers      | 2–3   |
| Open-source maintainers, indie founders   | Mentions on Hacker News                                | "Threads about my project"                      | HN Algolia ✓; Reddit ✗; F5Bot is free    | 2–3   |
| Quality and compliance managers           | Revisions to the standards I certify against           | "ISO 9001 revision status"                      | Unchecked                                | 2–3   |

## Top 5 to add to the marketing list

1. **Strike watch** (4). Riksmekleren lists every mediation with its deadline. One brief
   answers "will this hit my family?" before the deadline, not on the morning of it.
2. **Scam watch for my parents** (4). Free scam newsletters exist in the US and none in
   Norway. Finanstilsynet posts warnings almost weekly. It also makes an easy gift.
3. **Concessions near my home or cabin** (3–4). NVE's dated news names the kommune.
   This is a real, slow-moving worry, and nothing alerts people to it today.
4. **Slip watch** (3–4). A new watch type that fits Scout's "what changed since last
   time" exactly: a road, a game, a pledge. It works anywhere.
5. **New-build developer solvency** (3–4). Norway's real-estate bankruptcies were up 40%
   in Q1 2026. brreg is readable, and buyers have a lot at stake.

Timely runner-up: **Nordic border controls**, which started 12 Nov 2026.

## Checked and already covered

These are in the docs already, or are near-duplicates:

- **Life events.** Wedding (weak), baby recalls, kindergarten, death and estate
  (heirs), divorce and court cases, retirement and pension, moving, school admission,
  students and scholarships, military service, benefits (US VA included).
- **Business and work.** Tenders, patents, trademarks, competitor prices (rival watch),
  media mentions, VC deal flow (leads), job pages at named employers (saved-search).
- **Tech.** CVEs, relicensing, API sunsets, release notes (breaking change), ToS changes
  (fine-print), bill tracking (rule change).
- **Hobbies and the outdoors.** Space launches, birding, aurora, reissues (wait for an
  event), government surplus and second-hand finds (collectors).
- **Abroad.** Diaspora, voting from abroad, remittances, India exams.
- **Not Scout's game or already served.**
  - Price, restock and appointment slots.
  - Load-shedding and lift outages (minute-level).
  - Data breaches (Have I Been Pwned covers them).
  - Deed fraud (counties offer free alerts; Home Title Lock is paid and criticised).
  - Unclaimed property (a lookup, not news).
  - Obituaries (minnesider unchecked; score 2).
  - Satellite and webcam images, library new arrivals (not readable).
  - Court hearing lists (domstol.no is JavaScript).

Round 1 covered the seven lenses and a keyword sweep of the docs. Round 2 covered the
adjacent products and spot-checked the sources. Round 3 covered organisational teams,
the statistics calendar and the court lists, and found only near-duplicates.
