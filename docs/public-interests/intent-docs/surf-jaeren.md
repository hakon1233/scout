# Jæren surf this weekend (tested)

**Verdict:** a small niche that works, but only as a Friday "is the weekend worth it" brief.
Norway has a few hundred to low thousands of surfers (a 2024 study quotes "a few hundred"
on Jæren; the federation publishes no headcount). Apps already show the numbers, and
surf-forecast.com writes its own one-line summary. What the brief adds: one verdict across
three spots, the winter bird-protection ban, the week's biggest swell, and the rare Jæren
contest or rule news. Demand 2/5 (inferred): confirm with Jæren surfers before it goes live.

**Width:** one region, Jæren (Bore, Hellestø, Reve harbour). Surfers drive to one coast; a
Norway-wide brief would mix Jæren, Stad and Lofoten, which share no weather. Lofoten
(`/breaks/Unstad`), Stad (`/breaks/Hoddevik`) and Klitmøller (`/breaks/Klitmoller`) use the
same surf-forecast page shape, so each can be a copy with its own spots. Run on Fridays.
Local news is rare (a few items a year), so most briefs are forecast only.

**Score:** run 1 4/6 (weekday and 8-day windows padded the brief; no "worth it" call; the
winter ban missing) → run 2 6/6. Coverage: nothing on-scope missed.

## Sources checked (20 Nov 2026, web fetch and curl)

- ✓ surf-forecast.com spot pages: server-rendered, dated "forecast from <date>", summary
  sentences plus a 7-day AM/PM/Night table with rating, height, period, wind and sea
  temperature. The wind-state row doesn't line up with its columns in the fetched text.
- ✓ api.met.no oceanforecast JSON: works without a custom User-Agent, dated `updated_at`,
  but only wave height and sea temperature, no period. A fallback, not a first source.
- ✓ brettforbundet.no/surf: dated news, mostly federation admin. /surf/events was empty.
- ✓ statsforvalteren.no Jærstrendene page: the winter ban (1 Nov–31 Mar) and the
  bird-protection areas. Tourism pages still say 1 Oct.
- ✗ Windy (JavaScript only), Surfline (403), yr.no coast pages (redirect to another
  place), DMI hav-og-is (no numbers), surf-norge.no news (fetch got no items), surfing.no
  (redirects to a shop), lofotenmasters.com (404). coldhawaiigames.com has a dated
  programme but no news list. Web search found only tourism pages and 2016–2021 contests.

## Intent doc

```markdown
# Jæren surf this weekend

## Reader

Surfers in Stavanger and Jæren deciding on Friday whether the weekend is worth it, and which spot and hours to aim for.

## Report

Up to 4 stories, in this order:

- The best weekend window (Friday evening to Sunday): one story per spot that has one, best first
- The week's biggest swell, if it comes later than Sunday: the forecast's "most powerful swell", up to 8 days ahead, marked "early forecast"
- Jæren news from the last 7 days: a surf competition, club day or course with a date, or a change to beach rules or parking

## Skip

- Weekday windows, unless it is the week's biggest swell
- Spots outside Jæren (Lista, Stad, Lofoten), kite and windsurf news
- Surf schools' standing offers, gear, travel stories
- Federation admin news (reporting, grants, staff), contests abroad

## Sources, check first

- https://www.surf-forecast.com/breaks/Bore/forecasts/latest/six_day : the top line "Bore surf forecast from <date>" is the issue date. Below it: "Best quality surf", "Most powerful swell", "Next surfable swell" with day, hour, height, period, wind. Then a table per day (AM / PM / Night): height, period, direction, rating, wind km/h.
- https://www.surf-forecast.com/breaks/hellesto/forecasts/latest/six_day : same, for Hellestø.
- https://www.surf-forecast.com/breaks/Reve-Havn/forecasts/latest/six_day : same, for Reve harbour; holds bigger swell.
- https://www.brettforbundet.no/surf : surf federation news, dated d.m.yyyy, newest first. Most items are admin; keep only Jæren events and contests.

The wind-state row in the tables does not line up with its columns. Take "offshore / cross-offshore" from the summary sentences, and only km/h and direction from the table. Windy, Surfline and yr show no numbers to the fetch tool.

Winter rule: from 1 November to 31 March, surfing is banned in bird-protection areas (fuglefredingsområde), among them Reve hamn–Orre, which takes in Piggy just south of Reve harbour. Never point readers to Piggy in that period. Source: https://www.statsforvalteren.no/nn/rogaland/privatperson/natur-og-friluftsliv/nyheiter/2026/10/jarstrendene/

## Search terms

Search only for news, not forecasts: surfekonkurranse Jæren, Jæren surfklubb, Borestranda parkering

## Each story must state

- The date in backticks: the surf day and hours (CET) for a window; the publish date for news; the event day for an event
- A one-line verdict first: "Worth the drive" (rating 3 or more, or period 10 s or more with offshore or cross-offshore wind), "Marginal" (rating 1–2), or "Not worth it" (rating 0, or onshore wind). An early forecast gets "Watch" instead
- Spot, wave height in metres, period in seconds, swell direction, wind km/h and direction
- Sea temperature, once per brief
- The forecast's issue date, and a link to the spot page

## No change

If no Jæren spot has a window rated 1 or more from Friday evening to Sunday, write one line: "No surfable window on Jæren this weekend (<dates>); next swell: <day, spot, height, period> or none in 8 days." Don't pad with weekday or rating-0 windows.

## Language and place

Read English and Norwegian sources, write in English. Heights in metres. Jæren, Rogaland, Europe/Oslo.
```

## Test notes

- Run 1 (first draft): 4 fetches, 2 searches. Brief: Bore Sat 21 Nov 16:00 1.6 m 7 s NW;
  Reve Sun 22 Nov 0.9 m 9 s; Hellestø Wed 25 Nov 1.7 m 9 s offshore; the 16 s swell on
  28 Nov. Faults: the Wednesday and 28 Nov items fell outside the draft's 4-day window; no
  "is it worth it" call; the winter ban was missing (it was published in October, outside
  the 7-day news window, yet in force now).
- Run 2 (this doc): 4 fetches, 3 searches. Brief, forecast issued 20 Nov, sea 10.4 °C:
  1. `2026-11-21 15:00–18:00` Bore, Marginal: 1.6 m, 7 s NW, 15 km/h NNE, rating 2;
     the morning has 35 km/h N wind.
  2. `2026-11-22` morning, Reve harbour, Marginal: 0.9 m, 9 s NW, 5 km/h ENE
     cross-offshore, rating 1. Not Piggy (winter ban).
  3. `2026-11-28 22:00` Bore, Watch (early forecast): 1.4 m, 16 s WNW, the biggest swell
     in 8 days; Hellestø 1.3 m, 16 s W at 19:00.
     No Jæren news in the last 7 days. Bore Saturday spot-checked against the page.
- Ratings were 0–2 all weekend; tune the verdict thresholds after a big-swell week.
- Reve harbour is "the last good spot before the bird sanctuary" (surfnerd.com); Piggy,
  just south, lies inside Reve hamn–Orre.
- Searches for contests and parking found only tourism pages; news searches rarely pay
  off, so the forecast pages do the work.
