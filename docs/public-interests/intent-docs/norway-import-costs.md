# Import costs for a Norwegian online shop or wholesaler (tested)

**Width:** one business type (small importer buying from China and Europe), whole
country, three drivers (container freight, the krone, customs and tax rules). Narrower
(freight only) is a price ticker most weeks; wider (all logistics) drowns in US trucking
and air cargo. Thresholds (freight ±5% or an announced increase, krone ±1.5%) keep quiet
weeks short.

**Score:** run 1 5/6 (krone "reason" came from a bank headline only, not a dated source;
one search spent on last year's budget deal) → run 2 6/6 with thresholds, "reason not
given", the import-weighted index, Loadstar as a fourth source and a trap list.

## Intent doc

```markdown
# Import costs for a Norwegian online shop or wholesaler

## Reader

A small Norwegian online shop or wholesaler that buys goods from China and Europe, by container or parcel, and wants to know each week what changed in freight, currency and customs rules, and what it does to landed cost.

## Report

- Container freight Asia to North Europe and the Mediterranean: a weekly rate move of 5% or more, carriers' announced increases (GRI, FAK) with their start date, blank sailings, Red Sea or Suez routing, port strikes or congestion in Europe or China
- The krone: a weekly move of 1.5% or more against USD, EUR or CNY, or in the import-weighted index (I-44), with the reason if a dated source gives one
- Norwegian customs and tax rules for importers: toll, VAT, VOEC, Digitoll, fees, CBAM, EUDR, product rules, budget changes to excise taxes (særavgifter); state proposed / adopted / in force
- EU and US trade measures that change prices or rules for goods Norwegian firms buy (EU duties on Chinese goods, EU fees on distance sales, US-China tariff steps that move Asian freight)
- Posten Bring, PostNord, DHL or forwarders' price changes or surcharges for business customers, with the date they apply

## Skip

- Daily rate ticks, freight forecasts and outlooks without a new fact, forwarder marketing posts and how-to guides
- US domestic trucking, air cargo, and transpacific news unless it moves Asia–Europe rates
- Consumer shopping news, stock-market news, interest-rate talk with no currency move

## Sources, check first

- https://data.norges-bank.no/api/data/EXR/B.USD+EUR+CNY+I44.NOK.SP?format=csv-:-comma-false-y&lastNObservations=6&locale=en (official rates, last six banking days; CNY is NOK per 100 CNY; I-44 higher = weaker krone). Compute the change from the first to the last row.
- https://www.freightos.com/feed/ (Tuesday "<date> Update" post: FBX Asia–N. Europe and Asia–Med $/FEU and drivers; open the post if the feed text stops short)
- https://www.toll.no/no/bedrift/nyheter-for-naeringslivet (dated DD.MM.YYYY; relative links, prefix https://www.toll.no)
- https://theloadstar.com/feed/ (dated Asia–Europe trade news)
- Traps: Drewry answers 429; dnb.no needs JavaScript; Bring price lists are PDFs; interest-rate commentary is not a story unless the krone moved; search often returns last year's budget deal, so check the budget year.

## Search terms

kontrollgebyr fjernsalg; statsbudsjettet <year> avgift import; budsjettforlik særavgifter <year>; Asia North Europe GRI <month year>; Red Sea Suez return Asia Europe <month year>; Bring prisendring <year> bedrift

## Each story must state

- What changed, with a date in backticks (published date for news; effective date for a rule or price change)
- The number before and after, and over what period
- Why, from the source; write "reason not given" if none
- What it means for landed cost: which imports, which direction
- For rules: status (proposed, adopted, in force), effective date, link to the official page

## No change

Look at the last 7 days. If every move is inside the thresholds, write one line: "No change in import costs since <date>: freight Asia–N. Europe about $<rate>/FEU, USD/NOK <rate>." Don't pad with outlooks.

## Language and place

Read Norwegian and English sources. Write in English. Norway, Europe/Oslo time.
```

## Test notes

- Run 1 (20 Nov): Freightos 17 Nov update (Asia–N. Europe flat about $3,400/FEU, −5% vs
  end of October, 40–50% above a year ago; December increases announced); USD/NOK
  9.53→9.69 and CNY +1.6% in six days; Tolletaten quiet. Lost the point on the krone
  reason (an unconfirmed bank headline about oil).
- Run 2: same three stories, krone with "reason not given", Tolletaten "no change in 7
  days", Loadstar items correctly skipped, and the run caught that "budsjettforlik" hits
  were from the 2026 budget, not 2027.
- Coverage gap: the 2027 budget's proposed 5% duty on clothing and textiles (October) and
  the EU control fee on distance sales (Tolletaten 29.10) were outside the 7-day window. A
  first run should look back 30 days for rules.
- Rejected sources: Drewry WCI (429), Nord Pool (JavaScript), dnb.no market news
  (JavaScript), dagligvarehandelen feed (404). splash247 and freightwaves feeds read fine
  but add little for Asia–Europe.
