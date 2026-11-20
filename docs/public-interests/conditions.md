# Conditions and moments

Niches about conditions at a place that people can't see by looking out of the window, and
now check by visiting several sites: the aurora (space weather plus cloud), ski openings
across many resorts, first ice from scattered reports.
Checked 19–20 Nov 2026 with WebFetch and curl (generic user agent).

**What works:** one official, dated forecast or plan list, plus a second factor the reader
can't see. The brief earns its place by settling conflicts between sources and giving a
verdict for a named place and night or weekend, not by repeating a dashboard. "First and
last" moments (season opening, first ice, last ski day) fit Scout best: rare, dated, and
easy to miss.

## Best picks

1. **Northern lights, Tromsø and Trondheim** (tested, 6/6):
   [intent doc](intent-docs/northern-lights-tromso-trondheim.md). NOAA's plain-text Kp
   forecast plus yr's sky label gives a "go / maybe / no" per city and night.
2. **Ski openings, southern Norway and Trøndelag** (tested, 6/6; no fresh-snow figures):
   [intent doc](intent-docs/norway-ski-openings.md). fnugg and skiinfo list ~60–74 resorts
   and often disagree; the brief gives both dates and confirms big resorts on the operator's
   page.
3. **Dutch natural ice**: the national "can we skate this weekend?" moment. Dated feed and
   news cover first ice and openings; only a few days a winter, so ask for a quiet brief.
4. **Minnesota first ice and ice fishing**: weekly dated reports from Outdoor News and
   Leech Lake; the state DNR and resort sites block fetches.

5. **Jæren surf this weekend** (tested, 6/6; demand 2/5, a few hundred surfers):
   [intent doc](intent-docs/surf-jaeren.md). surf-forecast.com spot pages plus the winter
   bird-protection ban at Piggy; a Friday "worth the drive / marginal / not worth it"
   verdict. Copy it for Stad (Hoddevik), Lofoten (Unstad) or Klitmøller.

## Candidates

| Sub-niche                      | Place                      | Who, how many                                                         | Sources (✓ readable, ✗ not)                                                                                                                                                                       | Cadence                    | Score |
| ------------------------------ | -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----- |
| Aurora chance per night        | Tromsø, Trondheim          | Visitors (Tromsø ~ several hundred thousand winter guests) and locals | NOAA 3-day Kp ✓, NOAA 27-day ✓, spaceweather.com ✓, yr daily table ✓, watchers.news ✓ (search); yr aurora tab ✗ (current hour only), api.met.no ✗ 403, UiT space weather ✗ undated                | Daily, Sep–Mar             | 4     |
| Ski openings, closings, tracks | Southern Norway, Trøndelag | Alpine and cross-country skiers, over a million                       | fnugg opening list ✓, fnugg "her går heisen" ✓, skiinfo snow report ✓, Skiforeningen føremelding ✓, alpinco.com ✓, skistar.com ✓ partly; sporet.no ✗ JS, skitour.no ✗, resort sites often undated | Thursdays, Nov–Apr         | 4     |
| Natural ice openings           | Netherlands                | Skaters, millions when ice comes                                      | natuurijswijzer.nl feed ✓, natuurijs.nl map ✓ (dated, no text per rink), schaatsen.nl ✓ undated, NOS and regional news ✓                                                                          | Daily in frost, else quiet | 4     |
| First ice, ice fishing         | Minnesota                  | Ice anglers, several hundred thousand                                 | outdoornews.com reports ✓ dated, leechlake.org ✓ dated titles; MN DNR ✗ 403, lakeofthewoodsmn.com ✗ 403, iceshanty ✗ 403                                                                          | Weekly, Nov–Mar            | 4     |
| Blue mussel warnings           | Norway's coast             | Mussel pickers, tens of thousands                                     | Mattilsynet blåskjellvarsel ✓ (status per site, no date per site)                                                                                                                                 | Weekly Fridays, Mar–Oct    | 3     |
| Crane counts                   | Hornborgasjön, Sweden      | Bird watchers and day trippers, ~100,000 a spring                     | hornborga.com ✗ 403; Länsstyrelsen news dated, untested                                                                                                                                           | Twice weekly in season     | 3     |
| Rare birds                     | Netherlands                | Birders, thousands                                                    | dutchbirding.nl ✓ dated list; alert apps serve it already                                                                                                                                         | Daily                      | 3     |
| Sakura and autumn leaves       | Japan                      | Visitors, millions                                                    | japan-guide.com reports ✓ dated; well served already                                                                                                                                              | Daily in season            | 3     |
| Tour-skating ice               | Norway, Sweden             | Tour skaters, thousands                                               | Skridskonätet ✗ login, sssk.se ✓ no reports, Facebook ✗, varsom ice ✗ no text                                                                                                                     | Daily in season            | 2     |
| Spring ski touring             | Norway                     | Ski tourers                                                           | skitour.no ✗, fjellforum.no ✗ 403                                                                                                                                                                 | Weekly, Mar–May            | 2     |
| Mushroom and berry season      | Norway                     | Foragers                                                              | soppognyttevekster.no ✓ but sparse                                                                                                                                                                | Weekly, Aug–Oct            | 2     |

## Dropped

- **Pollen, local weather, kite wind**: people see or feel them, and apps already show them.
- **Stargazing and meteor showers**: a fixed calendar; nothing new to find.
- **Aurora dashboards alone** (live Kp, webcams): a dashboard, not a brief.
- **Bymarka ski tracks**: sporet.no is JavaScript-only.
- **Minnesota DNR ice data, Maine foliage**: 403 to both tools.
- **Trondheim bathing water**: summer only; not tested.
- **Fresh snow per resort**: no readable source gives figures; left as a gap in the ski doc.
