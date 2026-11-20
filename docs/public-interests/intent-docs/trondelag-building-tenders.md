# Building and maintenance tenders and new projects in Trøndelag (tested)

**Width:** one trade group (small building, electrical, plumbing, carpentry and
engineering firms), one county. TED with Trøndelag's region code and building CPV codes
gives about 4 notices a week and 13–15 in two weeks. Norway-wide is about 60 a week, too
many to read and too big to fetch. Trondheim alone is 1–2 a week, often none.

**Score:** run 1 4/6 → run 2 6/6. In run 1 the 7-day TED window held 4 notices: 2 were
off scope (graffiti, a gate award with no lead) and 2 were usable. Zoning plans had no
publish date, so "new" was a guess, and both news searches returned old projects. Run 2
used a 14-day window with "deadline still open", opened the notice's /html page for
details, dated plans by their comment deadline, and dropped news search to one try.

## Intent doc

```markdown
# Building and maintenance tenders and new projects in Trøndelag

## Reader

A small building, electrical, plumbing, carpentry or engineering firm in Trondheim or Trøndelag that wants new public work to bid on, and early signs of building projects it could join as a subcontractor.

## Report

- Public tenders, framework agreements, qualification rounds and market dialogues in Trøndelag for building, rehabilitation, electrical, plumbing, HVAC, building maintenance, groundwork or engineering and architecture services, published in the last 14 days with the deadline still open
- Award notices for building projects that name the winning main contractor (a subcontract lead)
- New Trondheim zoning plans (oppstart, offentlig ettersyn, vedtatt) with address and who proposed it
- Large building projects in Trøndelag that get a budget, a contractor or a start date

## Skip

- Goods supply, IT, cleaning, graffiti removal, snow clearing and winter road work, mapping and surveys
- Award notices that name no contractor, and awards for services outside building
- Home renovation offers, job ads, project news with no new date or decision

## Sources, check first

- https://ted.europa.eu/en/simap/rss-feed/-/rss/generate?query=%28place-of-performance+IN+%28NO060%29%29+AND+%28classification-cpv+IN+%2845000000+71000000+50700000%29%29+AND+%28publication-date%3E%3Dtoday%28-14%29%29&title=TED&description=TED&fields=publication-date%2C+deadline-receipt-request%2C+notice-type%2C+buyer-name&language=EN&scope=ALL&limit= (EU tenders in Trøndelag, 14 days; buyer, publish date, deadline, notice type)
- For details, open https://ted.europa.eu/en/notice/<ID>/html with the notice ID from the feed (scope, start and end, tender link). The /detail/ links in the feed need JavaScript.
- https://www.trondheim.kommune.no/aktuelt/kunngjoring-arealplan/ (plans with comment deadline; no publish date, so a plan is new if its deadline is 3 weeks or more away)
- Traps: Doffin and Mercell need JavaScript; bygg.no forbids scraping; Adressa is paywalled. TED only has notices above the EU threshold; smaller jobs are on Doffin only.

## Search terms

Trondheim kommune anbud bygg <month year>; Trøndelag fylkeskommune byggestart <year>; Statsbygg Trondheim kontrakt <year>; totalentreprenør Trondheim <month year>

## Each story must state

- What is wanted, from whom and where, with the publish date in backticks
- Notice type: tender, qualification, framework, market dialogue or award
- Deadline for tenders or requests to take part, and for questions if given
- Size if given (m², value, years and renewals) and the start date
- Link to the TED /html page or the tender documents

## No change

If nothing in the last 14 days is on scope with an open deadline, write: "No new building tenders in Trøndelag since <date>." List open deadlines from earlier briefs only if they close in the next 7 days.

## Language and place

Read Norwegian and English sources. Write in English, keep Norwegian names of buyers and places. Trøndelag, Europe/Oslo time.
```

## Test notes

- Run 1 (20 Nov, 7-day window): NTNU sliding-door automation framework (deadline 17 Dec,
  1+3 years from 22 Jan 2027); Statsbygg lift-alarm market dialogue; Trondheim plans
  (Nordre gate 4 og 6, Steinanvegen 66, Kommunedelplan næring) without publish dates. Off
  scope: graffiti framework, Forsvarsbygg gate award. Searches for new projects returned
  2024–2025 stories (Katta, Værnes, Trondheim S).
- Run 2 (14-day window): Statsbygg NTNU Campussamling P6 HUMSAM turnkey partnering
  qualification (about 34,000 m² new building plus demolition of Berg and Metallurgi;
  4 May 2027 to end 2030; requests due 14 Dec); Trondheim kommune emergency excavation
  framework for water and sewage (due 11 Dec); Statsbygg planning-services frameworks (due
  7 and 8 Dec); NTNU sliding doors (17 Dec). Plans dated by deadline. Correctly skipped
  winter roads, bathymetric surveys and awards that name no contractor.
- Coverage gap: TED misses Doffin notices below the EU threshold, which is most small
  municipal jobs. Doffin's own free alerts cover those but need an account.
- Rejected sources: Doffin (JavaScript, API needs a key), Mercell (JavaScript), Trondheim
  innsyn for building permits (JavaScript), bygg.no project database (terms forbid
  scraping), TED search page and /detail/ pages (JavaScript), TED /xml (429).
