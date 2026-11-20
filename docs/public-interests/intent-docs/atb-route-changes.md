# AtB bus route changes in Trondheim (tested)

**Width:** kept as is: Trondheim plus the four nearby towns AtB serves; boats and one-off
delays left out. About 1–2 new notices a week, so most daily runs should say "No change",
but it still runs daily because closures matter on the day. Ferries and fast boats
(Fosen, Brekstad) are on the same page; add them here if readers ask, not as a new
interest.

**Score:** run 1 4/6 (7-day window repeated notices on a daily run; a non-route news item)
→ run 2 6/6.

## Intent doc

```markdown
# AtB bus route changes in Trondheim

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

Read Norwegian sources, write in English. Keep stop and street names in Norwegian. Trondheim, Europe/Oslo.
```

## Test notes

- The list page has 12 notices against the RSS feed's 5, plus "Oppdatert" dates, so it
  goes first.
- Run 2 brief: Ila, Skansen and Kongens gate stops closed three nights, 22–25 Nov
  23:00–05:30, lines 3, 11, 18, 21, 75 rerouted; then the "No new AtB changes" line.
  Lines spot-checked against the page.
