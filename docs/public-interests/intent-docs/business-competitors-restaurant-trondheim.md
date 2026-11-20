# New competitors and closures near a Trondheim restaurant (tested)

**Width:** every new or bankrupt serving place in Trondheim kommune, with the ones near
Midtbyen first. One kommune is about one to four openings and one or two konkurser a week;
the whole of Trøndelag would bury the reader.

**Score:** run 1 5/6: it reported three re-registered old places (the Sverresborg museum
café, a tavern from 1739, a banquet hall, one owner, all on one day) as new openings, and
on a first brief the 7-day window dropped two konkurser from 8 days earlier → run 2 6/6
after a re-registration skip rule, a 14-day first-brief window, closures by forced
winding-up and a "kommune must be Trondheim" check.

## Intent doc

```markdown
# New restaurants and closures in Trondheim

## Reader

The owner of a restaurant in Midtbyen, Trondheim, who wants to know which places open and close nearby each week.

## Report

- New restaurants, cafés and bars registered in Trondheim (new sub-units in brreg), nearest first
- Restaurants, cafés and bars in Trondheim that went bankrupt or were wound up by force (a "KONKURSBO" or "TVANGSAVVIKLINGSBO" unit is registered for the estate)
- New places getting their first Mattilsynet inspection (smilefjes), which shows they have opened

## Skip

- Catering-only firms, food trucks and festival stands, unless at a fixed address in Midtbyen
- Places outside Trondheim kommune (the list includes some whose head office is in Trondheim: check the address)
- Holding companies and name changes with the same address and owner
- Re-registrations of places already open: several units of one owner registered the same day, or oppstartsdato months before the registration (e.g. a museum café). Give them one line, "re-registered, not new", or skip them
- Reviews, opening-party news, chains' press releases

## Sources, check first

- https://data.brreg.no/enhetsregisteret/api/underenheter?kommunenummer=5001&naeringskode=56&sort=registreringsdatoEnhetsregisteret,desc&size=30 (JSON, newest registrations first: navn, registreringsdatoEnhetsregisteret, oppstartsdato, naeringskode1, beliggenhetsadresse). Code 56.1 = restaurants and cafés, 56.2 = catering, 56.3 = bars. The kommune filter lets in places elsewhere in Norway: keep only beliggenhetsadresse.kommune TRONDHEIM.
- https://data.brreg.no/enhetsregisteret/api/enheter?navn=konkursbo&kommunenummer=5001&naeringskode=56&sort=registreringsdatoEnhetsregisteret,desc&size=20 (JSON, bankruptcy estates of serving firms, newest first; the estate's registration date is within days of the konkurs; this list also lets in other kommuner: check the postnummer)
- https://smilefjes.mattilsynet.no/kommune/trondheim/ (all places sorted by latest inspection, with dates; a place with only one date is new. The grade isn't in the text: don't guess it.)

## Search terms

Use search only to name a place's concept or say if a bankrupt place still serves: "<name>" Trondheim restaurant åpner; "<name>" konkurs Trondheim. Adresseavisen is paywalled: headline and time only.

## Each story must state

- Name, street address and type (restaurant, café, bar)
- Opened or closed, and the date in backticks (brreg registration date; also oppstartsdato if given; konkursbo registration date for closures)
- One line on how near it is: Midtbyen, Bakklandet, Solsiden (postnummer 7010–7018, 7041–7042) count as near; elsewhere in Trondheim say the area
- Link to https://virksomhet.brreg.no/nb/oppslag/underenheter/<org number> or /enheter/<org number>

Group: one story for openings near me, one for closures, one for openings elsewhere in Trondheim (a line each). Konkursbo units also appear in the first list: report them only as closures.

## No change

Report registrations dated in the last 7 days; on the first brief (no earlier brief given), the last 14 days. If none, write "No new or closed restaurants in Trondheim registered since <date>." Don't pad.

## Language and place

Read Norwegian. Write in English. Trondheim, Norway, Europe/Oslo.
```

## Test notes

- Sources checked with WebFetch: both brreg JSON URLs return JSON; smilefjes returns
  places and inspection dates but not the grade (it sits in an attribute the tool drops).
  Both brreg lists let in places outside Trondheim (Oppdal, Snåsa, Tromsø, Bergen and
  others) because the filter matches the head office; the doc now says to check the address.
- Search found nothing on The Deco's concept; it confirmed Borgstua and the Tavern are
  long-standing places at Sverresborg museum. Use search for concept only.
- Run 2 brief (first brief, 6–20 Nov): openings near me: The Deco AS, Kjøpmannsgata 52
  (registered `2026-11-17`, started `2026-10-23`); Lille Delikatessefabrikken AS, Fotveita 1
  (`2026-11-10`, starts `2027-01-01`); Mare Seafood AS, Fjordgata 56 (`2026-11-07`, starts
  `2026-12-01`). Closures: Erketroll AS, Bispegata 9A, and Snackyard Solsiden AS, Beddingen
  10, konkursbo registered `2026-11-12`. Elsewhere: Borgstua, Tavern and Victoriasalen, one
  line, "re-registered, not new". Catering firm skipped.
- Gap: smilefjes added nothing a brreg list didn't already show, and its grade is
  unreadable; a place that opens without a new sub-unit (same firm, new address) is missed.
