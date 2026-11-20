# Høringer om natur, friluftsliv og jakt (tested)

**Width:** nature, outdoor life, hunting and fishing across the state, not one department.
Regjeringen's Klima og miljø list alone has had no new nature høring since 23 Sep; most
items in scope come from Miljødirektoratet and Statsforvalteren, about 2–4 a month.

**Score:** run 1 4/6 (said "no new høringer" while Miljødirektoratet had two open in scope:
it only read regjeringen's lists) → run 2 6/6 with the doc below.

## Intent doc

```markdown
# Høringer om natur, friluftsliv og jakt

## Reader

People in Norway active in nature and outdoor groups (turlag, jeger- og fiskeforeninger, naturvern, grunneiere) who want to know when the state asks for comments on rules for nature, outdoor life, hunting and fishing, so they can answer before the frist.

## Report

- New høringer on naturmangfold, verneområder, friluftsliv, motorferdsel i utmark, jakt, fangst, innlandsfiske, rovvilt, villrein and hytte/strandsone rules
- From Klima- og miljødepartementet, Miljødirektoratet, Landbruks- og matdepartementet and Statsforvalteren
- When a høring closes or the rule is adopted, one line with the result

## Skip

- Climate quotas, emissions, waste and pollution høringer with no nature or outdoor angle
- News articles about a case unless they link the høring
- Local reguleringsplaner

## Sources, check first

- https://www.regjeringen.no/no/dokument/hoyringar/id1763/?ownerid=668 (Klima- og miljødepartementet's høringer, newest first; each shows published date, frist and status)
- https://www.regjeringen.no/no/dokument/hoyringar/id1763/?ownerid=627 (Landbruks- og matdepartementet: jakt, viltloven, utmark, statsallmenning)
- Miljødirektoratet's list (miljodirektoratet.no/hoeringer) needs JavaScript and shows nothing. Find its høringer by search, then fetch the høring page itself: each page shows "Publisert" and "Frist". Most of its høringer are discharge permits for one plant; skip those.
- Traps: Miljødirektoratet's homepage and year pages are empty without JavaScript; hoering.miljodirektoratet.no is empty; there is no RSS.

## Search terms

site:miljodirektoratet.no/hoeringer <current year> <current month name>; Miljødirektoratet høring verneområde <year>; høring jakttider <year>; høring motorferdsel utmark <year>; Statsforvalteren høring verneplan <year>; høring villrein <year>

Search hits are often closed høringer from earlier years. Use only those with Publisert in the last 30 days or an open frist.

## Each story must state

- Title and who sent it
- Published date and høringsfrist in backticks
- Status: på høring / under behandling / ferdigbehandlet
- What would change, in one or two lines
- Link to the høring page

## No change

New høringer here come about once a month. If none was published since the last brief, write "Ingen nye høringer om natur, friluftsliv eller jakt siden <dato>." Then list, one line each, open høringer in scope with title, frist and link, so the reader still sees what can be answered. If none are open, say so.

## Language and place

Read Norwegian (bokmål and nynorsk). Write in Norwegian bokmål. Norway, Europe/Oslo.
```

## Test notes

- Rejected sources: miljodirektoratet.no/hoeringer, its year and month pages, its homepage
  and hoering.miljodirektoratet.no (all need JavaScript; no RSS). Single høring pages there
  are server-rendered with "Publisert" and "Frist", so search + fetch works.
  Regjeringen `?topic=925` duplicates `?ownerid=668` and adds nothing.
- Statsforvalteren høringer are per county; search finds them, no national list.
- Run 2 brief: Miljødirektoratet "restriksjon mot blyhagl" (published 12 Nov, frist 4 Jan
  2027, på høring) and "bly i fiskeutstyr" (2 Nov, frist 14 Dec), then open høringer as one
  line each: Bøkleppen naturreservat, Surnadal (frist 27 Nov) and the besøkssentre strategy
  (frist 31 Dec). It correctly skipped NOU Matsystemet, oil-field discharge permits and
  CBAM. Neither page gives an in-force date; the brief said "ikke oppgitt".
