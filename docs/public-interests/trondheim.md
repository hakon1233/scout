# Trondheim public interests

Research pass 20 Nov 2026. Demand is **inferred** for nearly every row; searches of
Reddit, diskusjon.no and Kvinneguiden returned no usable threads. ✓ = fetched and
readable. Already in `../MARKETING.md`: student events this week, startup and tech
events, festivals and volunteer calls (with the student event sources).

## Best picks

1. **AtB route changes, stop closures and detours** (5, daily). atb.no/driftsmeldinger is
   readable and names lines and stops. Every bus rider needs it; the app only shows
   today's disruptions.
2. **Council decisions on housing, parking and roads** (5, weekly).
   trondheim.kommune.no/aktuelt/nyheter is readable with the byråd's case list.
3. **Roadworks and closures, incl. the E6 rebuild** (4, daily). AtB plus kommune news.
4. **Kids and family events, school holidays** (4, weekly). trdevents.no has a "Barn /
   familie" filter.
5. **Trøndelag fylkeskommune committee meetings** (4, weekly; round 2). Buses, ferries
   and upper secondary schools. opengov.360online.com/Meetings/TRONDELAG is readable and
   dated; nobody reports the agendas well.
6. **Trondheim in English** (4, weekly; round 2). A newcomer digest for NTNU
   international students and staff: AtB changes, kommune news, SiT housing deadlines
   and events, read in Norwegian and written in English. Several expat Facebook groups
   and r/trondheim housing threads, almost no English local news. Uses NTNU's readable
   SiT pages instead of the blocked sit.no.
7. **Salmon fishing closures, Nidelva and Gaula** (3, Jun–Aug only; round 2). Gaula,
   Orkla and Verdalselva closed from 1 Aug 2026. miljodirektoratet.no news and tofa.no
   are readable and dated.

Tested intent docs for picks 1, 2 and 4 are in [intent-docs/](intent-docs/).

**trdevents.no** is one readable, dated source behind many sub-niches (kids, markets,
talks, gaming, theatre, food). One interest per filter is cheap to set up, but its
server-rendered list only reaches about two days ahead.

## All sub-niches

| Sub-niche                                          | Serves                         | Sources                                           | Cadence      | Tags                       | Score |
| -------------------------------------------------- | ------------------------------ | ------------------------------------------------- | ------------ | -------------------------- | ----- |
| AtB route changes, stop closures, detours          | Bus riders, students           | atb.no/driftsmeldinger ✓                          | Daily        | local, ev-transport        | 5     |
| Council decisions on housing, parking, roads       | Residents                      | trondheim.kommune.no news ✓; innsynsportal (JS)   | Weekly       | local, housing, regulation | 5     |
| Planning notices and hearings                      | Neighbours, activists          | kommune høringer page ✓ (looks stale)             | Weekly       | local, housing             | 4     |
| Roadworks and closures (E6 rebuild)                | Commuters, cyclists            | atb.no ✓, kommune news ✓, vegvesen.no ?           | Daily        | local, ev-transport        | 4     |
| Student housing (SiT queue, offers, rent)          | New and international students | sit.no ✗ (403)                                    | Weekly       | local, housing, study      | 4     |
| Bymarka ski track prep                             | Skiers, parents                | sporet.no ✗ (JS), kommune page ✗ (404)            | Daily winter | local, outdoors            | 2     |
| Kids and family events, school holidays            | Parents                        | trdevents.no ✓                                    | Weekly       | local, family, events      | 4     |
| Avalanche, flood and ice warnings for Trøndelag    | Skiers, hikers                 | varsom.no ✓ partial                               | Daily        | outdoors                   | 3     |
| RBK women's team                                   | Women's football fans          | rbk.no ✓ (no women's section seen)                | Weekly       | local, sports              | 3     |
| Jazz and club gigs                                 | Live-music fans                | dokkhuset.no ✓ (may be stale)                     | Weekly       | local, music, events       | 3     |
| Big-venue concerts (Olavshallen, Spektrum)         | Concert-goers                  | olavshallen.no ✓                                  | Weekly       | local, music, events       | 3     |
| Classical, church and choir concerts               | Classical audience             | trondheimsolistene.no ✓ (dated)                   | Weekly       | local, music               | 3     |
| Theatre and dance premieres                        | Theatre-goers                  | trdevents.no ✓                                    | Weekly       | local, events              | 3     |
| Markets, fairs and flea markets                    | Second-hand fans               | trdevents.no ✓                                    | Weekly       | local, events              | 3     |
| Free talks and public lectures (NTNU Kveld)        | Curious residents              | trdevents.no ✓, dokkhuset.no ✓                    | Weekly       | local, events              | 3     |
| Board games, gaming nights, Hexcon                 | Hobby gamers                   | trdevents.no ✓; hexagon.no ✗                      | Weekly       | local, games-tabletop      | 3     |
| Climbing comps, route resets, intro sessions       | Climbers                       | klatreverket.no ✗ (404); dates mostly on Facebook | Weekly       | local, sports              | 3     |
| Running races and orienteering                     | Runners                        | trondheimmaraton.no ✓                             | Weekly       | local, sports              | 3     |
| Grants for local clubs and culture                 | Club leaders, artists          | kommune tilskudd page ?                           | Weekly       | local, funding             | 3     |
| Seniors' activities (Den kulturelle spaserstokken) | Pensioners, relatives          | kommune senior pages ?                            | Weekly       | local, events              | 3     |
| Stand-up and comedy nights                         | 20s crowd                      | olavshallen.no ✓                                  | Weekly       | local, events              | 2     |
| Public PhD defences and open lectures              | Alumni, public                 | ntnu.no (404 on path tried)                       | Weekly       | local, space-science       | 2     |
| Cruise ship calls                                  | Locals, shops                  | trondheimhavn.no (table likely JS)                | Weekly       | local                      | 2     |
| Volunteer calls (frivilligsentraler)               | Retirees, newcomers            | frivillig.no ?                                    | Weekly       | local, events              | 2     |
| Swimming hall hours and closures                   | Swimmers, parents              | kommune pages ?                                   | Weekly       | local, sports              | 2     |
| Rehearsal rooms for bands                          | Musicians                      | kommune pages ?                                   | Weekly       | local, music               | 2     |
| Student organisations beyond linjeforeninger       | International students         | ntnu.no org list ✓ (no event feed)                | Weekly       | local, study               | 2     |

## Dropped

- Student rental and sublets: only Finn and Facebook groups.
- Company presentations at linjeforeninger: Facebook or login pages.
- Adressa-only items: paywalled.
- Bysykkel updates: app only.
- Rosenborg men's team and NRK Trøndelag roundups: already well covered.
- Kulturnatt: not held in 2026.
- Police log (politiloggen): JavaScript only; api.politiet.no doesn't resolve.
- Bymarka ski tracks: sporet.no is JavaScript only, the kommune page 404s, and the
  Granåsen site points to a Facebook group. No readable live source.
- SiT housing via sit.no: still 403. Folded into "Trondheim in English".
- Byåsen handball (JavaScript portal), Nidaros ice hockey (JavaScript, local press covers
  it), TRV waste (no news list), parking rules (come via council decisions), council
  agenda portals (JavaScript), new restaurants (Adressa only), elk quotas (scattered
  PDFs), municipal jobs (job alerts exist).

## Round 2 additions (20 Nov 2026)

| Sub-niche                                    | Serves                           | Sources                                                                         | Cadence        | Score |
| -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------- | -------------- | ----- |
| Fylkeskommune committee meetings and agendas | Commuters, parents, coast towns  | opengov.360online.com/Meetings/TRONDELAG ✓ dated; trondelagfylke.no news ✗ (JS) | Weekly         | 4     |
| Trondheim in English (newcomer digest)       | International students and staff | atb.no ✓, kommune news ✓, ntnu.edu SiT pages ✓ undated, trondheim.esn.no ✓      | Weekly         | 4     |
| Salmon fishing: Nidelva and Gaula            | Anglers, river owners            | miljodirektoratet.no/aktuelt/nyheter ✓ dated, tofa.no ✓ dated                   | Weekly Jun–Aug | 3     |
| Climbing comps and events (GRIP)             | Climbers                         | gripklatring.no ✓ dated, plus an iCal feed                                      | Monthly        | 3     |
| Large predators and hunting quotas           | Hunters, sheep farmers           | statsforvalteren.no Trøndelag (undated), jeger.no/nyheter ✓ dated               | Monthly        | 3     |
| DNT Trondheim hut and trip news              | Hikers (~21k members)            | dnt.no TT aktuelt ✓ dated, ut.no ✓ dated                                        | Monthly        | 3     |
| Board games and Hexcon                       | Hobby gamers                     | hexagonspillklubb.org ✓ dated                                                   | Monthly        | 2     |
| Pilgrim route, Olavsfestdagene, Nidarosdomen | Pilgrims, culture audience       | olavsfest.no ✓, nidarosdomen.no ✓, pilegrimsleden.no ✓ dated                    | May–Aug        | 2     |
| Kolstad handball                             | Handball fans                    | kolstad-handball.no ✓ dated                                                     | Weekly         | 2     |
| Library events                               | Families, seniors                | library event list ✗ (JS); programme PDF twice a year                           | Weekly         | 2     |
| Værnes airport changes                       | Travellers                       | avinor.no ✓ but no news list                                                    | Monthly        | 2     |

Ferries and fast boats (Fosen, Brekstad) are on atb.no/driftsmeldinger: fold them into
the AtB interest. Klatreverket is Oslo only; the Trondheim gym is GRIP. hexagon.no is
dead; the club is at hexagonspillklubb.org.
