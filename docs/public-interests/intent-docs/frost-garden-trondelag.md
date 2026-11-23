# Frost and garden jobs, Trøndelag (tested, partly works today)

**Width:** one region, one weather verdict a week plus the one or two jobs the weather forces
(cover roses, lift dahlias, drain hoses, sow cold-germinators). Runs Sundays, March to November.

**Score:** run 1 (23 Nov 2026) 4/6. Weather part works (yr gives a 7-day table). The job part
fails: the Norwegian garden pages found were undated or old (klikk.no "Hagen i november"
is from 2008, updated 2017) and no weekly Norwegian garden column exists. The freshness check
would drop them. Needs the "make" mode (jobs written from the weather and the season, no source) to
reach 6/6; today it is a frost verdict only.

## Intent doc

```markdown
# Frost and garden jobs, Trøndelag

## Reader

Home gardeners and allotment holders in Trøndelag who want to know what the coming week's weather means for the garden.

## Report

- Frost: the first night below 0 °C, a night colder than -5 °C, or a mild spell above 5 °C after a frost, in the next 7 days, with dates and the lowest temperature
- Snow cover forecast, or heavy rain, that changes what can be done outside
- A statement from Statsforvalteren Trøndelag landbruk (weekly letter) about frost, drought, or pests that also hit gardens
- The one or two jobs the weather decides this week, each tied to a number from the forecast (cover tender plants before -5 °C, water conifers during a mild spell)

## Skip

Plant ads, seasonal sales, general gardening tips with no date, magazine pages with no date, fertiliser guides.

## Sources, check first

- https://www.yr.no/nb/v%C3%A6rvarsel/daglig-tabell/1-211102/Norge/Tr%C3%B8ndelag/Trondheim/Trondheim : 7-day table, date per row, max and min temperature, rain. Use the min temperature for frost.
- https://www.statsforvalteren.no/nb/trondelag/kommune-og-tjenesteaktor/landbruk-for-kommunen/informasjonsbrev-til-kommunene/ : the weekly letter ("Informasjonsbrev uke 47/2026"), one dated page a week. Farm-focused; take only what hits gardens.

Traps: klikk.no garden articles carry old dates; Norsk Hagetidend and Hageselskapet pages are paywalled or undated. Do not use them as sources for "this week".

## Search terms

frost hage Trøndelag, vintertildekking planter, Statsforvalteren Trøndelag landbruk informasjonsbrev

## Each story must state

- The date or the day of the forecast row, in backticks
- The temperature behind each job ("Tue 24 Nov: -8 °C")
- Link to the yr page or the letter

## No change

If no night is below 0 °C and no letter has news: "No frost or garden warning in the next 7 days (lowest <x> °C)." Do not pad with general tips.

## Language and place

Read Norwegian, write in English or Norwegian as the reader set it. Trøndelag, Europe/Oslo.
```

## Test notes

- Run 1 (23 Nov 2026): yr Trondheim 23-29 Nov: every night below 0, lowest -9 (25-27 Nov),
  highest +1 (29 Nov); no rain. Statsforvalteren's uke 47 letter found in search (wet, cold
  season in Trøndelag), not fetched. Klikk article was a 2008 text, rejected as undated. Hand-written
  brief: "Hard frost all week, -9 on 25-27 Nov; cover tender plants; no mild spell before 29 Nov".
- Fails checks: "On scope" is thin when only weather is reported, and the jobs have no dated source.
- Next step: allow jobs to be written from the forecast without a source, or accept a weather-only brief.
