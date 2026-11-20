# Saved searches

Niches where people now run the same search again and again, or keep a saved search, for
things a bit more complex than the weather: new job ads in one field, høringer on one
subject, decisions from one tribunal, calls for one kind of grant. Norway and the Nordics
first, then the world. Surf and the conditions family are in [conditions.md](conditions.md).
Checked 19–20 Nov 2026 with WebFetch and curl (generic user agent).

**What works:** a server-rendered list the site lets you filter in the URL, with a
relative date (`published=now-7d`) or a dated register, plus one source the big portals
miss. Scout earns its place by merging 3–5 such lists and cutting the off-field hits a
keyword search drags in. A plain saved search or Google alert does half the job: it
finds the keyword but not "in scope, still open, not seen before".

**What fails:** official lists behind JavaScript (Miljødirektoratet, jobbnorge, Doffin,
EU funding portal), sites that block the fetch tool but not curl (EURAXESS, WikiCFP,
Songkick), and web search alone, which mostly returns last season's closed ads and
høringer.

## Best picks

1. **PhD and postdoc jobs in computer science and AI, Norway** (tested, 6/6):
   [intent doc](intent-docs/phd-postdoc-cs-ai-norway.md). Four arbeidsplassen queries with
   `published=now-7d`, plus Simula's own list.
2. **Høringer on natur, friluftsliv og jakt** (tested, 6/6):
   [intent doc](intent-docs/hoeringer-natur-friluftsliv-jakt.md). Regjeringen lists by
   department, plus search for Miljødirektoratet and Statsforvalteren pages.
3. **Research funding calls, Forskningsrådet** (3): one list with deadlines, but no
   publish dates and partly cut at 24K characters.
4. **Artist grants, Kulturdirektoratet** (3): 72 schemes, open/closed and deadlines.
5. **Husleietvistutvalget decisions** (3): Lovdata register, dated, 20 a page, batches
   every two weeks. Overlaps rental law in [norway.md](norway.md).

## All candidates

| Sub-niche                        | Place     | Who and how many                                                                           | Sources (✓ fetch works, ✗ not)                                                       | Cadence             | Score |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------- | ----- |
| PhD/postdoc jobs, CS and AI      | Norway    | Master's students and postdocs; a few thousand a year (rough)                              | arbeidsplassen search ✓, simula.no ✓, jobbnorge ✗, EURAXESS ✗, karrierestart ✗       | 3–8 ads/week        | 4     |
| Høringer, natur/friluftsliv/jakt | Norway    | Turlag, hunters' and anglers' groups, landowners; NJFF and DNT have over 100k members each | regjeringen høringer ✓, Miljødirektoratet pages ✓ (list ✗), Statsforvalteren pages ✓ | 2–4/month           | 4     |
| Research funding calls           | Norway    | Researchers, grant offices; thousands                                                      | Forskningsrådet utlysninger ✓ (no publish dates), Innovasjon Norge ✗                 | weekly              | 3     |
| Artist grants and open calls     | Norway    | Artists and producers; ~10k                                                                | Kulturdirektoratet ✓, NBK ✓ (stale), Nordisk kulturkontakt ✓                         | monthly             | 3     |
| HTU decisions                    | Norway    | Landlords, tenants, lawyers                                                                | Lovdata register ✓, htu.no ✓ (undated)                                               | fortnightly batches | 3     |
| Personvernnemnda / Datatilsynet  | Norway    | DPOs and privacy lawyers; ~2k                                                              | Lovdata register ✓, Datatilsynet aktuelt ✓                                           | weekly              | 3     |
| Konkurser by kommune and bransje | Norway    | Suppliers, local press, job seekers                                                        | Brreg kunngjøringer ✓ (absolute dates in URL; æøå garbled)                           | daily               | 3     |
| Trygderetten decisions           | Norway    | NAV lawyers, claimants' groups                                                             | Lovdata register ✓                                                                   | weekly              | 2     |
| UK employment tribunal decisions | UK        | HR and employment lawyers; ~10k                                                            | gov.uk atom feed ✓                                                                   | daily, high volume  | 2     |
| Rare birds                       | Trøndelag | Birders; ~2k active                                                                        | Artsobservasjoner homepage ✓ (national only; county search ✗), artsdatabanken ✗      | daily               | 2     |
| Calls for papers                 | World     | Researchers                                                                                | WikiCFP ✗ (no HTTPS), conference sites scattered                                     | weekly              | 2     |

## Dropped

- Concerts by genre: Songkick shows a geolocated page to the fetch tool; overlaps the venue
  niches; Bandsintown already alerts.
- Open datasets: data.norge.no needs JavaScript.
- Volunteer roles, Innovasjon Norge grants, Doffin tenders: covered elsewhere or blocked.
- Used gear ads (finn.no): price tracking, out of scope.
- EU funding portal: JavaScript only.
- Stortinget komitéhøringer: fetch shows "Fant ingen høringer" with the default filter.
