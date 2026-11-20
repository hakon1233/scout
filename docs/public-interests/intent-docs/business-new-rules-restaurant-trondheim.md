# New rules for a Trondheim restaurant or café (tested)

**Width:** every national rule that reaches a serving place, plus Trondheim's skjenketider.
Narrower (alcohol only) is quiet for months; wider (all business rules) buries the reader.
Expect zero to two items most weeks; the "No change" line will be common.

**Score:** run 1 6/6 on the checks, but two of five fetches were wasted: regjeringen's
all-news RSS (100 calendar items and EEA novel-food notes) and nothing from Mattilsynet;
it also had to open a "merverdiavgiftsforskriften" change to see it only covers travellers'
duty-free goods. Run 2 6/6 with regjeringen's høringer list in place of the RSS and a
"read before reporting" rule. Both briefs were honest "No change" weeks.

## Intent doc

```markdown
# New rules for restaurants, cafés and bars in Trondheim

## Reader

The owner of a restaurant or café in Trondheim with a skjenkebevilling and 5–20 staff, who wants to know which new rules change their costs, duties or opening hours.

## Report

- New or changed forskrifter that reach a serving place: food hygiene, allergen and origin labelling, alcohol and skjenking, tobacco and snus sales, MVA and særavgift on food and drink, minimum wage (allmenngjort lønn) in serving, working hours, internkontroll, cash registers (kassasystem)
- Proposals out for høring on the same topics, with the høring deadline
- Arbeidstilsynet or Mattilsynet notices aimed at serving places: inspection campaigns, new demands
- New minimum wage rates: serving has allmenngjort lønn (overnatting, servering og catering), so a rise across the allmenngjorte trades counts even if the news item doesn't name serving; say "serving likely included" and link Arbeidstilsynet's minimum-wage page
- Trondheim kommune decisions on skjenketider, skjenkebevilling rules, outdoor serving (uteservering) or fees

## Skip

- Rules for fish farms, animal health, farms, hunting, defence, police
- Rules for food producers or shops only, unless they also apply to serving
- One restaurant's own case, award or closure
- Advice pages with no change ("slik søker du skjenkebevilling")

## Sources, check first

- https://lovdata.no/register/forskrifter (new central forskrifter, newest first, 20 a page, about three weeks; date is in the id: FOR-2026-11-18-2389 = 18 Nov 2026; ministry under each). Most are off-topic: read titles and keep only the topics above.
- https://www.arbeidstilsynet.no/nyheter/ (Arbeidstilsynet news, dated)
- https://www.regjeringen.no/no/dokument/hoyringar/id1763/ (open høringer from all ministries, newest first, each with "Høringsfrist"; most are off-topic)
- Mattilsynet's rules arrive as Lovdata forskrifter (Landbruks- og matdepartementet, Helse- og omsorgsdepartementet). Its news list (undated, mostly fish and animals) and its høringer page (JavaScript, 429) don't work; regjeringen's all-news RSS is calendar items and EEA notes. Skip them.
- Read the item itself before reporting: a title like "endring i merverdiavgiftsforskriften" may only cover travellers' duty-free goods. Lovdata items are at https://lovdata.no/dokument/LTI/forskrift/<yyyy-mm-dd-nnnn>.

## Search terms

skjenketider Trondheim bystyret; skjenkebevilling Trondheim formannskapet; allmenngjøring overnatting og servering. Search mostly returns old forskrift PDFs and other kommuners' høringer: use a hit only if it is about Trondheim and dated in the window.

## Each story must state

- What changes for a restaurant, in one line
- Status: proposed (høring, with deadline), decided, or in force; write "status not given" if the page doesn't say
- The date in backticks and which date it is (published, decided, in force from, høring deadline)
- Link to the official text (Lovdata, regjeringen, Arbeidstilsynet, kommune) first; news second

## No change

Report items published or decided in the last 7 days. If none, write "No new rules for serving places since <date>." Don't pad with older rules or advice pages.

## Language and place

Read Norwegian. Write in English. Trondheim and Norway, Europe/Oslo.
```

## Test notes

- Sources checked with WebFetch: Lovdata `register/forskrifter` ✓ (20 a page, 18 Nov back
  to 26 Oct; ministry filter works with the full name, e.g.
  `?ministry=Helse- og omsorgsdepartementet`); Lovdata item pages ✓; Arbeidstilsynet
  nyheter ✓ dated; regjeringen høringer list ✓ dated with deadlines; regjeringen all-news
  RSS ✓ but useless; Mattilsynet `hoeringer?themes=mat` ✗ (429 to WebFetch, list is
  JavaScript to curl).
- Search for Trondheim skjenketider returns old forskrift PDFs and other kommuners'
  World Cup høringer; the current Trondheim forskrift was adopted 2 May 2024 (sak 61/24).
- Run 2 brief (window 13–20 Nov): "No new rules for serving places since 13 Nov 2026."
  Correctly skipped the 16 Nov MVA change (travellers' duty-free alcohol and tobacco), the
  12 Nov særavgift delegation and NOU 2026:13 on the food system (6 Nov, out of window).
  Nearest miss: Arbeidstilsynet's "Høyere minstelønn fra 6. november" (9 Nov), out of the
  7-day window and not naming serving; the Report rule above now catches it.
