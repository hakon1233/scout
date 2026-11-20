# Business watches beyond supply, leads and industry news

What else a business owner would want Scout to watch, the starter pack Scout suggests per
trade at sign-up, and which trades to market to first. Supply chain and input costs, leads
and industry news are in [business.md](business.md). Norway first.
Sources checked 20 Nov 2026 with WebFetch and curl (generic user agent).

**What works:** two free registers do most of the work. **Lovdata's list of new
regulations** is dated, newest first and filterable by ministry: one fetch shows every new
rule (MVA, fishing, food, procurement). **The Brønnøysund API** (data.brreg.no, JSON, no
key) answers three questions with one static URL each: has a named customer gone bankrupt,
who went bankrupt in my kommune this week, and who just opened in my trade near me. Scout
earns its place by reading these with the owner's trade, kommune and customer list in mind.

**What fails:** reviews (Google, Trustpilot, Tripadvisor all block), building permits and
postjournal (kommune innsyn is JavaScript), roadworks (vegvesen.no is JavaScript),
trademark filings (Patentstyret search is JavaScript), tenders (Doffin), and the two big
grant bodies (Innovasjon Norge 403, Enova's news 404 after a host redirect).

## Watch types

✓ = readable and dated, ~ = readable but undated or partial, ✗ = blocked. Score 1–5 = need ×
how badly it is served today × whether Scout can read it.

| Watch                                    | Who wants it                                        | Example topic                                                       | Sources                                                                                                                                                       | Cadence                 | Score |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----- |
| Customer and partner credit watch        | Anyone who invoices firms: builders, wholesale, B2B | "Tell me if any of these 20 customers goes bankrupt or dissolves"   | brreg API `organisasjonsnummer=a,b,c` ✓ JSON (konkurs, avvikling, tvangsoppløsning, last accounts year); brreg kunngjøringer ✓ (absolute dates in URL)        | Daily or weekly         | 5     |
| New rules for my trade                   | Every trade                                         | "New rules for restaurants and bars in Norway"                      | Lovdata new forskrifter ✓ (newest first, ministry filter); Arbeidstilsynet nyheter ✓; regjeringen RSS ✓; Mattilsynet nyheter ~ (theme filter, no dates)       | Weekly                  | 5     |
| Bankruptcies and closures in my kommune  | Local trades: suppliers, landlords, rivals, hirers  | "Konkurser i Trondheim, bygg og servering"                          | brreg `navn=konkursbo&kommunenummer=…&sort=registreringsdatoEnhetsregisteret,desc` ✓ (each estate registers as a new unit, with its trade)                    | Weekly                  | 4     |
| New competitors in my kommune            | Restaurants, salons, clinics, trades                | "New restaurants registered in Trondheim"                           | brreg `underenheter?kommunenummer=…&naeringskode=56.1&sort=…desc` ✓ (address included)                                                                        | Weekly                  | 4     |
| Named competitors' moves                 | All, strongest for SaaS, e-commerce, restaurants    | "What Rival A, B and C did: new sites, jobs, prices, products"      | arbeidsplassen by employer ✓; brreg new sub-units ✓; competitor changelog or news page ✓ if server-rendered; Patentstyret ✗                                   | Weekly                  | 4     |
| Platform and marketplace policy          | E-commerce, app makers, advertisers                 | "Shopify and Meta ads changes that affect a small shop"             | Shopify changelog ✓ (day and month, no year); Meta business news ✓ dated, mostly marketing; Etsy via valueaddedresource feed ✓; Amazon Seller Central ✗ login | Weekly                  | 4     |
| EU product rules reaching small firms    | Makers, importers, food producers, e-commerce       | "PPWR packaging, GPSR, EUDR, Ecodesign: what hits a 10-person firm" | Lovdata ✓ (EØS rules arrive as forskrifter); regjeringen RSS ✓; EU sources not tested                                                                         | Monthly                 | 4     |
| Fishing regulation and quotas            | Fishing boats, fish buyers                          | "Kvoter og reguleringer, kystflåten"                                | Lovdata ✓ (e.g. leppefisk 2027 regulation, 11 Nov); Fiskeridirektoratet nyheter ✓ dated; J-meldinger list not tested                                          | Weekly, Nov–Feb busiest | 4     |
| Tax, MVA and fees for small firms        | Every owner, accountants                            | "Tax and MVA changes for sole traders and small AS"                 | Skatteetaten press RSS ✓; Lovdata ✓ (MVA forskrift change 16 Nov; 2027 rates 18 Nov)                                                                          | Weekly in budget season | 4     |
| Minimum wage and allmenngjøring          | Serving, cleaning, building, transport, farms, fish | "Allmenngjort lønn, servering"                                      | Arbeidstilsynet nyheter ✓ ("Høyere minstelønn fra 6. november", 9 Nov); Tariffnemnda ~ undated; Lovdata ✓                                                     | Monthly, quiet often    | 3     |
| Food-safety inspections nearby           | Restaurants, cafés, bakeries                        | "Smilefjes for me and five rivals"                                  | smilefjes.mattilsynet.no/kommune/… ✓ dated, newest first; the grade is only in the place page or an HTML title (fetch drops it)                               | Weekly                  | 3     |
| Grants, tax credits and support schemes  | Makers, farms, startups, energy-heavy firms         | "SkatteFUNN and support for small firms, what changed"              | SkatteFUNN ✓ (deadlines, 2027 changes); Landbruksdirektoratet ✓ dated; Forskningsrådet ✓; Innovasjon Norge ✗ 403; Enova ✗                                     | Monthly                 | 3     |
| Farm subsidies, deadlines and schemes    | Farmers                                             | "Produksjonstilskudd og frister"                                    | Landbruksdirektoratet nyhetsrom ✓ dated; Lovdata ✓                                                                                                            | Monthly                 | 3     |
| Customs and import rules                 | Importers, e-commerce                               | "Toll og avgift on goods I import from China"                       | toll.no aktuelt ~ (no dates; e.g. EU fee on distance sales from 1 Nov 2026); Lovdata ✓                                                                        | Monthly                 | 3     |
| Health and professional rules            | Dentists, physios, GPs, clinics                     | "HELFO and Helsedirektoratet changes for dental clinics"            | helsedirektoratet.no/nyheter ✓ (curl only, not checked with fetch)                                                                                            | Monthly                 | 3     |
| Local rules: serving hours, besøksbidrag | Bars, hotels, shops in one kommune                  | "Skjenketider and tourist tax decisions, Trondheim"                 | Council decisions ✓ (see [Trondheim council](intent-docs/trondheim-council-decisions.md)); kommune innsyn ✗                                                   | Weekly                  | 3     |
| Hard-to-hire roles                       | Restaurants (chefs), builders, transport, clinics   | "Who in Trondheim is hiring chefs this week"                        | arbeidsplassen with `published=now-7d` ✓ (tested in the PhD doc)                                                                                              | Weekly                  | 3     |
| My company and key customers in the news | Any owner                                           | "News about my firm or my three biggest customers"                  | Web search ✓; paywalled local press gives headline only                                                                                                       | Weekly                  | 3     |
| Footfall and access near my shop         | Shops, cafés                                        | "Roadworks and events in Midtbyen"                                  | vegvesen ✗ JS; kommune innsyn ✗; event lists ✓ (trdevents)                                                                                                    | Weekly                  | 2     |
| Commercial premises nearby               | Shops, cafés wanting a second site                  | "Serveringslokaler til leie, Trondheim sentrum"                     | Finn næringseiendom ~ (readable, no dates, "Nye i dag" count only)                                                                                            | Weekly                  | 2     |
| Policy rate and lending                  | Owners with loans, property                         | "Norges Bank rate decisions"                                        | Norges Bank press RSS ✓ dated                                                                                                                                 | 8 a year                | 2     |

**Brreg tips.** Use SN2025 codes: old `56.101` returns nothing, `56.1`, `96.2`, `86.2`,
`43.2` work as prefixes. Sorting by `registreringsdatoEnhetsregisteret,desc` means no date
in the URL, so the doc never goes stale. `konkursdato` can't be sorted; use the konkursbo
name trick instead. Some trading names are sub-units (`/underenheter`), not `/enheter`.

## Starter pack per trade

What Scout suggests when someone says "I run a …". Three to five watches; the first one is
the hook.

| Trade                            | Suggested watches                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restaurant, café, bar            | New restaurants and closures in my kommune · New rules for serving (Mattilsynet, alcohol, Arbeidstilsynet) · Smilefjes for me and rivals · Allmenngjort lønn, servering · Who is hiring chefs |
| Builder, electrician, plumber    | Credit watch on my customers and main contractors · Bankruptcies in bygg and anlegg, my region · New building rules (TEK, DiBK) · Allmenngjort lønn, bygg and elektro                         |
| E-commerce shop                  | Shopify (or WooCommerce) and Meta ads changes · EU and Norwegian rules on distance sales, customs and fees · Product rules: GPSR, packaging · Named competitors' launches                     |
| Importer, wholesaler             | Credit watch on my customers · Customs and import rules for my goods · EU product rules (EUDR, PPWR, Ecodesign) · MVA changes                                                                 |
| Hairdresser, beauty salon        | New salons in my kommune · Rules for cosmetics and treatments (Mattilsynet, Helsedirektoratet) · Tax and MVA for small firms · Bankruptcies of salons nearby                                  |
| Accounting firm (also a channel) | Tax, MVA and fee changes · New rules for small AS and sole traders · Credit watch on client firms · Lovdata new forskrifter from Finansdepartementet                                          |
| Transport, haulage, taxi         | Credit watch on customers · Rules for road transport (kabotasje, tolls, drivers' hours) · Allmenngjort lønn, godstransport · Bankruptcies in transport, my region                             |
| Fishing boat                     | Kvoter og reguleringer for my fishery · Fiskeridirektoratet notices · Rules on landing and reporting · Fish buyers' credit                                                                    |
| Farm                             | Produksjonstilskudd and deadlines · Mattilsynet animal-health alerts in my area · New farm rules (Lovdata, LMD) · Grants for farm investments                                                 |
| Dentist, physio, clinic          | HELFO and Helsedirektoratet changes · New clinics in my kommune · Rules on patient records and privacy (Datatilsynet) · Who is hiring dental nurses                                           |
| Hotel, guesthouse                | Besøksbidrag and local rules in my kommune · New rules for accommodation · Allmenngjort lønn, overnatting · Platform policy (Booking, Airbnb, Google)                                         |
| SaaS startup                     | Named competitors' changelogs and pricing · App store and platform policy · EU AI Act and GDPR decisions · Grants (SkatteFUNN, Forskningsrådet)                                               |

## Market check

Establishments in Norway, 2026 (SSB table 07091, all sizes / with staff):

| Trade (NACE)                      | All    | With staff | Pain                                                           | Already pays for                       |
| --------------------------------- | ------ | ---------- | -------------------------------------------------------------- | -------------------------------------- |
| Building and installation (41+43) | 66,610 | 24,326     | Most bankruptcies by count; unpaid invoices; rules change      | Credit checks (Creditsafe, D&B, Proff) |
| Health incl. dentists (86)        | 42,823 | 11,623     | Rules, staff                                                   | Little monitoring                      |
| Retail incl. e-commerce (47)      | 38,493 | 23,448     | Platform and EU rules, customs, rivals                         | Visualping-type tools, apps            |
| Wholesale (46)                    | 19,262 | 10,132     | Customer credit, customs, EU product rules                     | Credit monitoring                      |
| Land transport (49)               | 18,972 | 6,478      | Customer credit, transport rules                               | Credit checks                          |
| Personal services incl. hair (96) | 18,782 | 5,014      | Local rivals                                                   | Almost nothing                         |
| IT (62)                           | 18,679 | 6,123      | Rivals, platforms, EU AI Act                                   | Crayon, Visualping (bigger firms)      |
| Serving (56)                      | 15,215 | 9,253      | Highest bankruptcy rate (2.8 % of firms in 2025), rules, staff | Little; review tools in chains         |
| Legal and accounting (69)         | 7,378  | 4,129      | Rule changes for clients                                       | Proff Forvalt, Lovdata Pro, Retriever  |
| Fishing (03)                      | 7,182  | 1,325      | Quotas and rules change weekly in season                       | Little                                 |
| Agriculture (01)                  | 47,635 | 4,846      | Subsidy rules, deadlines                                       | Little; Bondelaget has ~60,000 members |

### Paid alternatives and prices

| Tool                         | Watches                       | Price (2026, third-party unless noted)                          |
| ---------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Creditsafe Norge             | Credit, bankruptcies, changes | Quote only; flat subscription, monitoring included              |
| Dun & Bradstreet (Bisnode)   | Credit monitoring             | 2021 list: 2,000 kr for 100 firms to 13,000 kr for 1,000, + MVA |
| Proff Forvalt                | Company data, alerts on firms | Quote only; single reports 349–990 kr                           |
| Retriever                    | Norwegian media mentions      | Quote only                                                      |
| Mention                      | Web and social mentions       | $599 a month (annual); old $49–179 plans closed                 |
| Talkwalker                   | Social listening              | ~$10,000–25,000 a year                                          |
| Brandwatch                   | Social listening              | ~$40,000–50,000 a year                                          |
| Crayon                       | Competitor intelligence       | ~$30,000 a year median                                          |
| Visualping                   | Page changes                  | Free for 5 pages; paid from ~$10–14 a month                     |
| Birdeye, Podium              | Reviews                       | $299–599 a month per location                                   |
| Mercell anbudsvarsling       | Tenders                       | Quote only                                                      |
| Google Alerts, Doffin alerts | Keywords, tenders             | Free                                                            |

The gap: small firms pay either nothing (Google Alerts) or enterprise prices. Nothing
between 0 and ~1,000 kr a month reads rules, registers and rivals together and says what
it means for one trade in one kommune.

## Top 3 trades to market to first

1. **Builders and installers (håndverkere).** The biggest group (24,000 with staff), the
   most bankruptcies, and they already pay for credit checks, so "tell me when a customer
   or main contractor is in trouble" is a known want at a Scout price. Every source works
   (brreg JSON, Lovdata, Arbeidstilsynet). Reach: Byggmesterforbundet, Nelfo, Rørentreprenørene,
   Byggeindustrien and Byggmesteren newsletters, wholesaler counters (Optimera, Ahlsell).
2. **Restaurants, cafés and bars.** 9,000 with staff, the highest bankruptcy rate, dense
   rules (Mattilsynet, alcohol, allmenngjort lønn), and local rivalry Scout can actually
   see (new and closed places in brreg, smilefjes dates). The hook demos well: "four new
   restaurants opened near you this month, two closed". Weak spot: owners are busy and
   spend little, so the brief must be short. Reach: NHO Reiseliv, Virke, local food
   networks (Trøndersk Matfestival in Trondheim).
3. **E-commerce shops and importers.** 23,000 retail plus 10,000 wholesale with staff; the
   rules land on them now (EU fee on distance sales from 1 Nov 2026, GPSR, packaging) and
   platform changes come weekly. The same pack works outside Norway, so it scales into the
   world list. Reach: Distansehandel Norge, Virke netthandel, Shopify partner and merchant
   communities.

**Channel, not a trade:** accounting firms (4,100 with staff) each serve dozens of small
firms and already pay for Proff Forvalt. A "rules and credit for your clients" pack sold
through Regnskap Norge could reach all three trades above.

## Dropped

- **Reviews and ratings:** Google, Trustpilot, Tripadvisor block; Birdeye and Podium own it.
- **Public procurement outcomes:** Doffin is JavaScript and its API needs a key.
- **Trademark filings:** Patentstyret search is JavaScript.
- **Building permits and postjournal near me:** kommune innsyn is JavaScript.
- **Roadworks:** vegvesen.no traffic is JavaScript.
- **Enova and Innovasjon Norge as main sources:** blocked; grants stay via SkatteFUNN,
  Forskningsrådet and regjeringen.
- **Energy, fuel and interest-rate prices:** price tracking; apps and news do it.
- **Insurance:** contract-specific, rarely news.
- **Weather risk:** yr and apps do it; see [conditions.md](conditions.md) for verdicts.
- **Filing deadlines (MVA terms, A-melding):** a fixed calendar, not news.
- **Payment and card fees (Vipps, terminals):** rare, and the provider emails each customer.
- **Trade fairs and exhibitor deadlines:** part of industry news in [business.md](business.md).
- **Amazon seller policy:** Seller Central needs a login.

## Tested starter-pack docs (20 Nov 2026)

Each run twice by hand (5 searches, 5 fetches), scored, fixed and run again.

| Doc                                                                                             | Score     | What the last brief found                                                                                             | Gaps                                                                                              |
| ----------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Credit watch, Trøndelag builder](intent-docs/business-credit-watch-builder-trondelag.md)       | 6/6 → 6/6 | Ruta Entreprenør konkurs `2026-11-02`, claims deadline `2026-11-30`; warning signs from `2026-09-01` (rekonstruksjon) | Past ~4 customers the fetch budget can't open every announcement list; search lags brreg by weeks |
| [New rules, Trondheim restaurant](intent-docs/business-new-rules-restaurant-trondheim.md)       | 6/6 → 6/6 | Honest "No new rules since 13 Nov"; skipped a travellers-only MVA change                                              | Mattilsynet has no working source; Trondheim skjenke decisions only by search                     |
| [Competitors and closures, Trondheim](intent-docs/business-competitors-restaurant-trondheim.md) | 5/6 → 6/6 | 3 openings near Midtbyen, 2 konkurser (12 Nov), 3 re-registered old places flagged as not new                         | Smilefjes grade unreadable; a firm opening a second place without a new sub-unit is missed        |

Corrections to the claims above:

- **Regjeringen RSS** works but holds calendar items and EEA notes; use the høringer list
  `regjeringen.no/no/dokument/hoyringar/id1763/` instead.
- **Mattilsynet:** news is undated and mostly fish and animals; its høringer page gives
  WebFetch a 429. Its rules arrive as Lovdata forskrifter.
- **brreg kommune filter** matches the head office, so `underenheter` and `konkursbo` lists
  include places in other kommuner; check the address. Re-registrations (several units, one
  owner, one day) look like openings.
- **brreg kunngjøringer** (`hent_nr.jsp`, `hent_en.jsp`) work in WebFetch and give early
  warning: Ruta's rekonstruksjon came two months before its konkurs.
