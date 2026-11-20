# Business topics

Scout topics for businesses, with Norway and the Nordics first. Each topic names a business
type and a place, and comes in one of three shapes:

- **Supply chain watch:** what drives a cost, not a price ticker.
- **Leads:** new work or customers.
- **Business news for one market.**

Sources were tested on 20 Nov 2026 with WebFetch and plain curl. Score 1–5 = need × how
badly it is served today.

## Best picks

1. **Import costs for a Norwegian online shop or wholesaler** (supply chain, 4). Freight
   from Asia, the krone and customs rules in one weekly brief. Every source reads well
   (Norges Bank CSV, Freightos feed, Tolletaten, Loadstar). Tested 6/6:
   [intent doc](intent-docs/norway-import-costs.md).
2. **Building and maintenance tenders in Trøndelag** (leads, 4). A TED RSS feed filtered
   to Trøndelag and building codes, plus Trondheim zoning plans. Tested 6/6:
   [intent doc](intent-docs/trondelag-building-tenders.md).
3. **China-sourcing freight and tariffs for small online sellers** (world, supply chain,
   4). The same sources as pick 1, with US and EU tariff steps instead of Norwegian toll.
4. **New companies in Trondheim, for accountants and B2B services** (leads, 3). brreg's
   open API, sorted by registration date and filtered by kommune and industry code.

**Finding:** TED's RSS generator takes an expert query and is the one readable door to
public tenders. Doffin and Mercell need JavaScript, and Doffin's API needs a key. Swap
`NO060` (Trøndelag) for any NUTS region and swap the CPV codes for any trade. TED only has
notices above the EU threshold.

## All candidates

| Sub-niche | Business type and place | How many | Sources | Cadence | Score |
| --- | --- | --- | --- | --- | --- |
| Landed cost: freight, krone, toll | Online shops and wholesalers that import, Norway | Thousands of firms in nettbutikk and wholesale (SSB NACE 47.91, 46) | Norges Bank ✓, Freightos ✓, toll.no ✓, Loadstar ✓, Drewry ✗ | Weekly | 4 |
| Building tenders and plans | Building, electrical, plumbing and engineering SMEs, Trøndelag | Several thousand firms in NACE 41–43 and 71 in Trøndelag | TED RSS ✓, TED /html ✓, Trondheim arealplan ✓, Doffin ✗, bygg.no ✗ | Weekly | 4 |
| China-sourcing freight and tariffs | Small Shopify and Amazon sellers, world | Very many | Freightos ✓, Loadstar ✓, splash247 ✓, freightwaves ✓ | Weekly | 4 |
| Building-material costs | Builders and carpenters, Norway | NACE 41–43, about 70,000 firms | SSB building cost index ✓, Byggevareindustrien ✓, EU steel rules (search) | Monthly | 3 |
| Bakery and food inputs | Bakeries and small food producers, Trøndelag | Hundreds | Landbruksdirektoratet ✓, Norgesmøllene ✓, toll.no ✓, Tine ✗ | Monthly (quiet most weeks) | 3 |
| New companies | Accountants and B2B services, Trondheim | About 25 new AS a week in Trondheim | brreg API ✓ (about 12 records fit in a run) | Weekly | 3 |
| IT consultancy tenders | IT consultancies, Norway | About 10,000 firms in NACE 62 | TED RSS ✓ (CPV 72, 48), Doffin ✗ | Weekly | 3 |
| Grocery market | Food suppliers to Norwegian chains | Hundreds | Konkurransetilsynet feed ✓, dagligvarehandelen ✗ | Weekly | 3 |
| State-agency tenders | Suppliers to state agencies, Norway | Broad | eu-supply DFO Atom feed ✓ (about 9 a week) | Weekly | 2–3 |
| Energy prices and grid tariffs | Energy-heavy SMEs, NO3 (Mid-Norway) | Broad | hvakosterstrommen ✓, Nord Pool ✗ | Weekly | 2–3 |
| Aquaculture market | Seafood suppliers, Norway | Hundreds | Well served by iLaks and Intrafish | Daily | 2 |

## Dropped

- **Price tickers** (spot power, daily freight index alone): a number without a driver is
  not a story, and free sites already show it.
- **Doffin tender alerts:** JavaScript only, and the API needs a key. Doffin's free email
  alerts already serve this.
- **Building permits in Trondheim:** the innsyn portal needs JavaScript.
- **bygg.no project database:** its terms forbid scraping and text mining.
- **Drewry WCI** (429) and **Nord Pool** (JavaScript): unreadable.
- **brreg leads for builders:** new building firms are competitors, not customers.
- **Bankruptcies by kommune:** already in [norway.md](norway.md).
