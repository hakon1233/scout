# Northern lights chances in Tromsø and Trondheim (tested)

**Width:** two cities, because the same space-weather forecast serves both and only the
cloud cover and the Kp needed differ. Tromsø sees aurora at Kp 2; Trondheim needs Kp 4 or
more. Add a city (Bodø, Alta, Reykjavík) as one more yr link, not a new interest. Runs
daily from September to March; most days the brief is one verdict line per city.

**Score:** run 1 5/6 (Kp blocks left in UT; no verdict per city; the Norwegian search found
only old articles) → run 2 6/6.

## Intent doc

```markdown
# Northern lights chances in Tromsø and Trondheim

## Reader

People in or visiting Tromsø and Trondheim who want to know which of the next three nights is worth going out for the northern lights.

## Report

- A night in the next 3 days with enough activity and a gap in the cloud, per city:
  - Tromsø: Kp 2 or more in the dark hours is often enough; Kp 4+ is a strong night.
  - Trondheim: needs Kp 4 or more, low in the north; Kp 5+ (G1 storm) for a good show.
- A NOAA geomagnetic storm watch (G1 or higher) or a CME expected to reach Earth, with the expected arrival in Norwegian time
- A storm that has just begun, or a watch that was cancelled
- On Thursdays only: the largest Kp the 27-day outlook gives for Friday to Sunday

## Skip

Aurora tours and ads, photo galleries, how-to guides, live Kp apps, articles older than 3 days, and storm news that only concerns the US.

## Sources, check first

- https://services.swpc.noaa.gov/text/3-day-forecast.txt : plain text. "Issued" line at the top; Kp per 3-hour block in UT for 3 days; the "Rationale" line says whether a G1+ storm is expected. Use it first for the next 3 nights.
- https://www.spaceweather.com/ : daily dated news on CMEs and storms; the date is at the top. Use the news, not its storm percentages.
- https://www.yr.no/nb/v%C3%A6rvarsel/daglig-tabell/1-305409/Norge/Troms/Troms%C3%B8/Troms%C3%B8 : Tromsø. A "Natt" and "Kveld" sky label per day (klarvær, delvis skyet, skyet, snøbyger).
- https://www.yr.no/nb/v%C3%A6rvarsel/daglig-tabell/1-211102/Norge/Tr%C3%B8ndelag/Trondheim/Trondheim : the same for Trondheim.
- https://services.swpc.noaa.gov/text/27-day-outlook.txt : largest Kp per day, rough. Only for the Thursday weekend line; the 3-day forecast wins where they differ.

Traps: yr's "Andre forhold" page shows only the current hour, and site.uit.no/spaceweather has no dated posts. Kp blocks are in UT: Norway is UT+1 in winter, so 18-21 UT is 19-22 Norwegian time. Dark hours in winter: Tromsø about 15:00-07:00, Trondheim about 17:00-07:00.

## Search terms

NOAA geomagnetic storm watch, CME arrival Earth, G1 watch Kp, watchers.news geomagnetic storm, nordlysvarsel

## Each story must state

- The date in backticks: the forecast's issue date or the article's date
- Which night (weekday and date) and which hours, in Norwegian time
- The Kp forecast for those hours and the yr sky label for that night, per city
- A one-line verdict per city: "go", "maybe, if the cloud breaks" or "no"
- Link to the NOAA text or the news item

## No change

Open every brief with one verdict line per city for the next 3 nights. If no night meets the thresholds and there is no new watch or CME, write only: "No good aurora night in the next 3 days (max Kp <x>; <sky labels>)." Don't pad with tips or past storms.

## Language and place

Read English and Norwegian sources, write in English. Tromsø and Trondheim, Europe/Oslo.
```

## Test notes

- Run 1 (20 Nov 2026): NOAA (issued 00:30 UTC) expected no storm 20–22 Nov, evening Kp
  2.0–3.0. yr: Tromsø cloudy or snow showers all three nights; Trondheim clear on Saturday
  evening but Kp about 2. spaceweather.com: a near-miss CME gave a G1 storm (Kp 5) early
  on 19 Nov. The brief was right but gave UT blocks and no verdict, and "nordlys i kveld"
  found only articles from earlier years.
- Run 2: verdicts "Tromsø: maybe, if the cloud breaks; Trondheim: no", the 19 Nov storm
  marked as past, and the 27-day outlook (Kp 2 for 23–25 Nov). Kp 3.00 for 21–00 UT on
  20 Nov spot-checked against NOAA.
- watchers.news writes up each NOAA watch with a dated URL; good for search, not fetched.
- The 27-day outlook (issued 16 Nov) said Kp 4 for 20 Nov while the 3-day forecast said
  3.67 at most, hence the "3-day wins" rule.
