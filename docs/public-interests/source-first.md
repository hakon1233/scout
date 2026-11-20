# Source-first check: what dated public sources unlock

The last check for missed use cases, done the other way round. Instead of starting
from people, start from the public, dated, machine-readable sources, and ask who would
want a brief when each one changes. Norway first (data.norge.no lists 2,866 datasets,
mostly static registers and health quality registers, few dated feeds), then the EU,
then global. Three rounds, all on 20 Nov 2026. Round 3 found nothing new.

✓ = readable with both WebFetch and plain curl, with dates; ~ = partly (too large,
oldest first, or IDs only); ✗ = blocked, JavaScript-only, needs a key or undated.
Score 1–5 = need × how badly it is served today.

## New use cases

| Source                                                          | Who                                           | The watch                                                            | Read | Score |
| --------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | ---- | ----- |
| eInnsyn API (`api.einnsyn.no/search`, newest first)             | Residents, cabin owners, action groups, firms | Anything in public journals naming my street, place, gnr/bnr or firm | ✓    | 4     |
| Fiskeridir aqua API + eInnsyn + Statsforvalteren høringer       | Cabin owners, anglers, river owners           | Fish-farm applications, expansions, lice reports near my place       | ✓    | 3–4   |
| tilskudd.no (172 state schemes, next deadline per scheme)       | Club, NGO and church-group organisers         | Grant deadlines for organisations like mine                          | ✓    | 3–4   |
| Statsforvalteren høringer per county                            | Residents, landowners, NGOs                   | County hearings near me (discharge permits, protected areas, farms)  | ✓    | 3     |
| Stortinget hearings API (`data.stortinget.no/eksport/horinger`) | NGOs, trade bodies, patient groups            | Committee hearings in my field, with the input deadline              | ~    | 3     |
| EU Have Your Say API (`brpapi/searchInitiatives`)               | SMEs, trade bodies, NGOs in the EEA           | EU consultations in my field, with the closing date                  | ✓    | 3     |
| DMP medicine-shortage list                                      | Patients on long-term medicine, carers        | Is my medicine short, and when is it expected back                   | ~    | 3     |
| arXiv API; PubMed (IDs only, needs a second call)               | Researchers, PhD students, clinicians         | New papers on my narrow topic, ranked and explained                  | ✓ ~  | 3     |
| endoflife.date API + CISA KEV                                   | Small-firm IT, MSPs                           | Patch and end-of-life brief for the software we run                  | ✓    | 3     |
| crt.sh certificate log                                          | Webshops, small firms                         | Lookalike domains of my brand (phishing)                             | ✓    | 2–3   |
| Vinmonopolet launch calendar (lists themselves likely JS)       | Wine, whisky and beer hobbyists               | Next release, the bottles worth queueing for                         | ~    | 2–3   |
| FCC ID filings (fccid.io)                                       | Gadget fans                                   | Early signs of a device from a named brand                           | ✓    | 2     |
| Wikipedia revisions API                                         | Firms, kommuner, public figures               | Edits to the page about us (Wikipedia's watchlist already does this) | ✓    | 2     |

Strongest: **eInnsyn**. It partly fixes the "kommune innsyn ✗" gap in `business.md`:
state agencies, Statsforvalteren and many fylker and kommuner publish journal titles
with address, gnr/bnr and company names (a street-name search gave 10 hits). Private
names are masked; documents need a request. Search with plain ASCII (`ø` gave a 400).

**Fix for `use-cases.md`:** J-meldinger are readable again at
`fiskeridir.no/Yrkesfiske/Regelverk-og-reguleringer/J-meldinger` (✓, J-204-2026). The
fishers row's ✗ is out of date.

## Source families already covered

| Family                                                                                       | Covered by                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------- |
| brreg kunngjøringer, konkurser, roles                                                        | business, gaps (myself in records) |
| Lovdata avgjørelser and forskrifter, Høyesterett, Sivilombudet, KOFA, Forbrukerklageutvalget | saved-searches, business-more      |
| Riksrevisjonen, Helsetilsynet tilsynsrapporter                                               | gaps (report card)                 |
| TED, Doffin, Konkurransetilsynet, smilefjes                                                  | business                           |
| SSB calendar, Riksmekleren, Finanstilsynet warnings                                          | gaps                               |
| regjeringen.no høringer, Landbruksdirektoratet; Nkom, DSA, NAV news (dated, generic)         | business-more; rule change         |
| Oslo Børs newsreader API ✓                                                                   | norway, nordics (investors)        |
| Kartverket EfS, NB API new items, ClinicalTrials, SkatteFUNN, Prosjektbanken                 | use-cases, conditions, business    |
| Federal Register, Regulations.gov, FDA recalls, OFAC, OpenFEMA, London Gazette ✓             | world, gaps                        |
| GitHub advisories, NVD, RFCs, ICANN, UN treaty notices                                       | use-cases (CVEs, rule change)      |

## Unreadable families

| Source                                                      | Why                              |
| ----------------------------------------------------------- | -------------------------------- |
| EU Safety Gate, sanctionsmap.eu, FinKN decisions            | JavaScript (Safety Gate API 405) |
| EUR-Lex, UN Security Council sanctions                      | 202 challenge                    |
| iso.org, IMF RSS, Arkivverket, Arbeidstilsynet opendata     | 403                              |
| Forbrukertilsynet                                           | 406 to curl                      |
| helsenorge waiting times, ePing (WTO), standard.no høringer | JavaScript, no dates in HTML     |
| BarentsWatch fish health                                    | 401, needs a key                 |
| DSB product warnings, Vegvesen recalls, Banenor works       | 404 or moved                     |
| norskeutslipp.no                                            | Old dates only                   |
| .no registrations, NOTAMs, tinglysing                       | Not public, or minute-level      |

## Judgement

The space is covered for _kinds_ of need. Every source family mapped onto an existing
watch type (radius, say-your-piece, claim window, rule change, rival, report card).
Round 1 found the rows above, round 2 found only covered or unreadable families, and
round 3 found nothing new. What source-first adds is **sources**, not needs: eInnsyn
and the aquaculture API unlock local watches that were ✗ before, and tilskudd.no is a
better source for club grants. Two real but thin groups remain: researchers (literature
watch, served free by Scholar alerts) and patients (medicine shortages, medical caution).
