# Use cases: who wants something watched, and why

Every kind of person or group who would pay attention to a Scout brief, the kinds of
"watch" they need, and which groups to market to first. Life roles, not topics. Business
owners' supply chain, leads and industry news are in the business research; here they
are one row. Four research rounds, 20 Nov 2026; demand rests on search snippets (Reddit
and Facebook block the tools) and on paid services that already exist.
✓ = fetched and readable with curl or WebFetch on 20 Nov; ✗ = blocked or JavaScript-only.

## The watch types (principles)

Scout's edge over Google Alerts and RSS is the same for all of them: it reads the 3–5
pages that matter, keeps what fits a written scope, says what changed since last time,
and says "No change" when nothing did. Google Alerts matches words in news (and has
degraded for years: 24–72 h delays, missed results); RSS gives every item from one site.

| Watch type              | Principle                                                                  | Example                                                              |
| ----------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Wait for an event       | One rare, dated thing will happen; tell me once, when it does              | Sequel or season announced; a ferry route reopens                    |
| Window opens            | A booking or application window opens, and early birds win                 | Hunting licence draw, school admission round, campsite release       |
| Deadline radar          | What closes in the next 2–6 weeks, in my field                             | Farm scheme deadlines; artist grants                                 |
| Rule-change radar       | Proposed vs in force, effective date, who it hits                          | Renters' rules for small landlords; ILR rules                        |
| Say-your-piece window\* | Flag the topic **before** the decision, while I can still act              | My street on the council agenda; a høring closing in 3 weeks         |
| Breaking-change watch\* | Will the next update break my setup?                                       | Home Assistant, Bambu firmware, an EV app ending support             |
| Sunset watch\*          | Something I rely on ends, closes or is discontinued                        | Bus route cut, drug discontinued, device end-of-support, branch shut |
| First / last moment     | Season openings and closings: rare, dated, easy to miss                    | First ice, ski openings, last ferry of the season                    |
| Verdict from conditions | One forecast + a factor I can't see → go / maybe / no                      | Surf this weekend; aurora tonight                                    |
| Threshold crossing\*    | A published number crosses my line                                         | Processing time under 6 months; river level for fishing              |
| Saved-search merge      | Merge 3–5 filtered lists, drop off-field hits and repeats                  | PhD jobs; government job notices (India)                             |
| Match my profile\*      | New items I now qualify for                                                | Trials recruiting for my condition, near me; a new benefit or grant  |
| Radius watch\*          | Anything new within X of a place                                           | Planning applications and roadworks within 300 m                     |
| Is anything wrong       | Recalls, outages, warnings for things I own                                | Car, child seat, medicine, food recalls                              |
| Who's new               | New entrants in a list                                                     | New clinics taking patients; leads (business)                        |
| Rival watch             | What a named competitor or opponent did                                    | Rival club's signings; competitor's patent filings                   |
| Counterparty watch      | The one organisation that holds power over me                              | My landlord's company, my employer, my bank's fee list, my kommune   |
| Fine-print watch\*      | A specific document's terms, fees or prices changed                        | Kindergarten fees, gym terms, platform API terms                     |
| Status of my case       | Public proxies only: queue stats, decisions in similar cases, rule changes | UDI waiting times; tribunal decisions like mine                      |
| Saga digest\*           | A slow reader's weekly catch-up of a long, fast-moving story               | A court case, a strike, a merger in my town                          |
| Look-ahead\*            | What's coming in the next 4 weeks in my yearly cycle                       | Hunter's, farmer's or taxpayer's calendar                            |

\* New types found in this research. Personal case status itself sits behind a login
(UDI, NAV, visa portals), so Scout can only watch public proxies.

**Not Scout's game:** minute-level races (visa or Bürgeramt slots, ticket drops, restocks;
bots win), prices, emergencies (weather warnings need minutes), anything behind a login.

## Groups

Score 1–5 = need × pain × willing to pay × readable sources × reachability.
Paying: y = people already pay for a similar watch (evidence); n = free tools or none.

### Life situations and processes

| Group                                                | What they'd watch                              | Example topic                                       | Sources                                    | Reach                                              | Paying                                                      | Score |
| ---------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------- | ----- |
| Immigrants and visa holders                          | Rule change, threshold (queue), status proxies | UK ILR; UDI waiting times                           | ✓ UDI, gov.uk; law-firm feeds              | r/ImmigrationCanada megathreads, expat groups, ESN | y: paid visa-slot alerts and bots (VisaBot, CheckVisaSlots) | 5     |
| People moving abroad                                 | Look-ahead, rule change (tax, residency)       | Moving to Spain: residency and tax changes          | ✓ official sites, law-firm feeds           | Expat forums, r/expats, InterNations               | n (inferred)                                                | 3     |
| Exam and public-job seekers (India et al.)           | Saved-search merge, deadline radar             | New central-government job notices for my degree    | ✓ mostly (official notices are often PDFs) | Telegram channels, YouTube, Sarkari sites          | n: free ad-funded apps, 5M+ installs (Sarkari Result)       | 3     |
| Job seekers in a niche                               | Saved-search merge                             | PhD jobs in CS, Norway (tested 6/6)                 | ✓ arbeidsplassen, university pages         | r/PhD, student unions, LinkedIn                    | y: LinkedIn Premium (indirect)                              | 4     |
| Freelancers                                          | Saved-search merge, deadline radar             | Public tenders for translators under 500k NOK       | ✗ Doffin; ✓ some portals                   | Freelancer unions, Upwork forums                   | y (inferred, tender-alert services)                         | 3     |
| Students                                             | Rule change, deadline radar                    | Lånekassen rules; scholarship deadlines             | ✓ lanekassen.no                            | Student unions, r/ntnu                             | n                                                           | 3     |
| People in a court case or divorce                    | Saga digest, status proxy                      | My case's docket; precedent decisions               | ✓ CourtListener (US); ✓ Lovdata registers  | Lawyers, support groups                            | y: Docket Alarm $39.99/mo; CourtListener free               | 3     |
| Heirs and estates                                    | Deadline radar, rule change                    | Inheritance tax and probate rules                   | ✓ official                                 | Hard: a one-off life event                         | n                                                           | 2     |
| Home buyers                                          | Rule change, wait for event                    | Mortgage rules, interest-rate decisions, area plans | ✓ central bank, Finanstilsynet             | Mortgage forums, banks                             | n (rates are covered by news)                               | 2     |
| Benefit claimants                                    | Rule change                                    | AAP, sykepenger, uføre (tested 6/6)                 | ✓ regjeringen, nav.no partly               | Patient and disability groups                      | n                                                           | 4     |
| Taxpayers with a twist (cross-border, self-employed) | Look-ahead, rule change                        | Norway–Sweden commuter tax                          | ✓ official                                 | Border-commuter groups, accountants                | y (accountants)                                             | 3     |

### Home and place

| Group                                   | What they'd watch                                         | Example topic                                         | Sources                                                                          | Reach                               | Paying                                                      | Score |
| --------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- | ----- |
| Residents watching their street         | Radius, say-your-piece, sunset                            | Planning and roadworks within 300 m of my house       | ✓ PlanIt UK API (dated JSON); ✗ planningalerts.org.au; kommune planinnsyn varies | Vel, neighbourhood groups, Nextdoor | n: PlanWatch, council alerts free; councils stopped letters | 4     |
| Housing co-op and sameie boards (B2B2C) | Radius, counterparty, rule change, sends to all residents | Borettslag brief: nabovarsel, roadworks, rule changes | ✓ kommune, vegvesen; varies                                                      | NBBL, USBL, OBOS board courses      | y (inferred: boards buy services from fellesutgifter)       | 4     |
| Small landlords                         | Rule change, decisions like mine                          | Renters' Rights Act; HTU decisions                    | ✓ gov.uk, Lovdata HTU                                                            | NRLA, Huseierne, Property118        | y: Landlord Law £25/mo, Guild £13/mo                        | 4     |
| Tenants                                 | Counterparty, rule change                                 | My landlord company's news; rent rules                | ✓ mostly                                                                         | Leieboerforeningen, tenant unions   | n                                                           | 3     |
| Cabin and second-home owners            | Rule change, conditions, sunset                           | Road open to the cabin; local fees and permits        | ✓ vegvesen, kommune                                                              | Hytteforeninger                     | n (inferred)                                                | 3     |
| Commuters                               | Sunset, wait for event                                    | AtB route changes (tested 6/6)                        | ✓ AtB notices                                                                    | Local groups                        | n                                                           | 3     |

### Family, care and health

| Group                                      | What they'd watch                                       | Example topic                                           | Sources                                                          | Reach                                     | Paying                                                | Score |
| ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------- | ----- |
| Parents of young kids                      | Is anything wrong, window opens, look-ahead             | Recalls of child products; kindergarten admission round | ✓ CPSC recalls RSS; ✓ Mattilsynet recalls (list undated)         | FAU, school newsletters, parent forums    | n: CPSC, Kids In Danger free                          | 3     |
| Parents of school kids                     | Say-your-piece, rule change                             | School board agenda: my school's closure                | ✓ agendas often PDF                                              | FAU/PTA, school Facebook groups           | y: Curate, Quorum (for advocates)                     | 3     |
| Carers of elderly parents                  | Threshold, rule change, who's new                       | Care-home places and rules in my kommune                | ✗ mostly no list; ✓ some UK councils, Eldernet (NZ)              | Pårørendealliansen, Carers UK             | n: none found; carers phone round                     | 3     |
| Patients with a rare condition, and carers | Match my profile, rule change (approval, reimbursement) | New trials recruiting for myasthenia gravis             | ✓ ClinicalTrials.gov API, FDA RSS, MHRA atom; ✗ Nye Metoder (JS) | Patient associations, Rare Disease Norway | y: DataLookout, Apify trial monitors (pay per result) | 4†    |
| People with allergies or coeliac disease   | Is anything wrong                                       | Food recalls for gluten and nut labelling errors        | ✓ Mattilsynet, FSA                                               | Cøliakiforeningen, allergy associations   | n                                                     | 3     |
| Pet owners                                 | Is anything wrong, rule change                          | Pet-food recalls; dog-breed and travel rules            | ✓ FDA, Mattilsynet                                               | Breed clubs, NKK                          | n                                                     | 2     |

† Medical topics were left out as risky to summarise (README). Trials, approvals and
reimbursement are factual register entries, not advice; a doc that only links and dates
them may be safe. Håkon's call.

### Owners of things

| Group                                 | What they'd watch                      | Example topic                                          | Sources                                | Reach                                | Paying                                            | Score |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------ | -------------------------------------- | ------------------------------------ | ------------------------------------------------- | ----- |
| Smart-home, home-lab, 3D-print owners | Breaking change, sunset                | Home Assistant, Bambu firmware (tested 6/6)            | ✓ GitHub releases, blogs               | Subreddits, official forums          | y: Visualping $10/mo is what they'd use instead   | 4     |
| Car and EV owners                     | Is anything wrong, rule change, sunset | Recalls for my 2022 Model 3; toll and charging rules   | ✓ NHTSA recalls API; ✓ vegvesen        | Elbilforeningen (100k+), owner clubs | n: NHTSA, makers notify free                      | 3     |
| Boat owners                           | Rule change, conditions                | Speed limits, harbour fees, first/last ferry           | ✓ Kystverket, kommune                  | KNBF, boat clubs                     | n                                                 | 2     |
| Drone pilots                          | Rule change, breaking change           | DJI firmware cutoff, EU drone rules                    | ✓ EASA, Luftfartstilsynet              | r/dji, drone clubs                   | n                                                 | 3     |
| Collectors                            | Saved-search merge, wait for event     | Upcoming lots of a coin series across 5 auction houses | ✓ some houses; ✗ many need login or JS | Collector clubs, forums              | y: Invaluable subscription; Ubuyfirst, SeeSpotBid | 3     |

### Work and profession (individuals)

| Group                                                             | What they'd watch                          | Example topic                                         | Sources                                                          | Reach                                 | Paying                                              | Score |
| ----------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- | ----- |
| Solo professionals (GPs, dentists, vets, solicitors, accountants) | Rule-change radar, deadline                | New rules from the Health Directorate for my practice | ✓ regulators' news pages                                         | Professional bodies, journals         | y: dental/vet digest $249/yr; firm monitors $5k+/yr | 4     |
| Teachers                                                          | Rule change, look-ahead                    | Curriculum and exam rule changes in my subject        | ✓ udir.no (large pages)                                          | Utdanningsforbundet, subject networks | n                                                   | 3     |
| Researchers and grant seekers                                     | Deadline radar, saved-search merge         | Forskningsrådet calls in my field                     | ✓ Forskningsrådet (no publish dates)                             | Grant offices, r/academia             | y: Research Professional (institutional)            | 4     |
| Artists and producers                                             | Deadline radar                             | Kulturdirektoratet grants and open calls              | ✓ Kulturdirektoratet                                             | Artist unions, NBK                    | n                                                   | 3     |
| Inventors and IP-heavy founders                                   | Rival watch                                | A competitor's new patent filings                     | ✓ USPTO/EPO data (via search)                                    | Patent attorneys                      | y: patentalert $5/mo; Mewburn £300–600/name/yr      | 3     |
| Small investors                                                   | Rival / counterparty (filings, not prices) | Insider buys and 8-Ks at my 5 holdings                | ✓ EDGAR full-text search JSON; ✗ browse-edgar without contact UA | r/investing, Shareville, Nordnet      | y: InsiderTradeAlerts $20–30/mo                     | 4     |
| Business owners                                                   | Supply chain, leads, industry news         | See the business research                             | —                                                                | —                                     | y                                                   | —     |

### Land, sea and outdoors

| Group                           | What they'd watch                         | Example topic                                          | Sources                                                          | Reach                                          | Paying                                             | Score |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- | ----- |
| Farmers                         | Deadline radar, rule change, look-ahead   | Scheme deadlines and changes (RPA, Landbruksdir.)      | ✓ gov.uk, regjeringen; ✗ some agency lists                       | Bondelaget, NFU, farm press                    | y (inferred: deadlines move often, money at stake) | 4     |
| Fishers                         | Rule change, window opens                 | Fiskeridirektoratet J-messages for my gear and zone    | ✓ fiskeridir.no/Yrkesfiske/Regelverk-og-reguleringer/J-meldinger | Fiskarlaget, Kystfiskarlaget                   | y (inferred)                                       | 3     |
| Hunters and anglers             | Window opens, rule change, say-your-piece | Høringer on hunting (tested 6/6); quota and draw dates | ✓ regjeringen høringer                                           | NJFF (100k+), local jeger- og fiskerforeninger | n                                                  | 4     |
| Outdoor and condition seekers   | Verdict, first/last moment                | Surf, aurora, ski openings (tested 6/6)                | ✓ see conditions.md                                              | Clubs, subreddits                              | n: surf apps have paid tiers                       | 3     |
| Gardeners and allotment holders | Look-ahead, is anything wrong             | Pest alerts and frost warnings for my region           | ✓ NIBIO plantevernvarsling                                       | Hageselskapet, allotment societies             | n                                                  | 2     |

### Civic and community (often teams)

| Group                                   | What they'd watch                           | Example topic                                     | Sources                             | Reach                                        | Paying                                        | Score |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------- | ----------------------------------- | -------------------------------------------- | --------------------------------------------- | ----- |
| Local journalists                       | Say-your-piece, saga digest, who's new      | Council agendas, bankruptcies in my kommune       | ✓ council registers, Brreg          | Press clubs, Agenda Watch users              | y: Agenda Watch (Stanford), Curate, Stateside | 4     |
| Local politicians                       | Say-your-piece, rival watch                 | My committee's cases; the other party's proposals | ✓ council sites, mostly             | Party groups                                 | y: PolicyMogul £195/mo (national level)       | 3     |
| NGOs, activists, patient groups (teams) | Rule change, say-your-piece                 | Consultations on my cause                         | ✓ regjeringen, gov.uk consultations | Frivillighet Norge, sector networks          | y: PolicyMogul £195/mo, Plural $3,500/yr      | 4     |
| Club and church organisers (B2B2C)      | Look-ahead, deadline radar; send to members | Grants for frivillige lag; local events this week | ✓ Frivillighetsregisteret, kommune  | Idrettsråd, menighetsråd, Frivillighet Norge | n (inferred: small budgets)                   | 3     |
| Sports-club fans and supporters         | Rival watch, wait for event                 | Rival club's signings; my club's ground plans     | ✓ club sites, mostly                | Supporter clubs                              | n                                             | 2     |

### Fans and hobbies

| Group                             | What they'd watch               | Example topic                                                | Sources                           | Reach                               | Paying                            | Score |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------ | --------------------------------- | ----------------------------------- | --------------------------------- | ----- |
| Fans of niche games and creators  | Wait for event, breaking change | Slay the Spire 2 updates                                     | ✓ Steam news                      | Subreddits, Discord                 | n                                 | 3     |
| Readers and series fans           | Wait for event                  | Next book in a series announced                              | ✓ publisher and author sites      | Goodreads groups, fandom subreddits | n: Netflix, LiveChart alerts free | 2     |
| "Wait for it" goals               | Wait for event, threshold       | Permit queue, a ticket sale date, a used Volvo 240 (✗ price) | varies                            | —                                   | y for slots (bots)                | 2     |
| Travellers before a trip          | Is anything wrong, rule change  | Japan: advisories, strikes, entry rules for my dates         | ✓ FCDO atom, travel.state.gov RSS | r/travel, travel forums             | n: FCDO, STEP alerts free         | 3     |
| Diaspora and expats watching home | Rule change, saga digest        | Voting from abroad; home-country tax for emigrants           | ✓ official                        | Diaspora associations               | n                                 | 2     |

## Top 10 groups to market to

1. **Immigrants and visa holders (5).** Hand-check weekly for months, high stakes, mod-run
   megathreads, already pay for slot bots. Tested ILR and UDI docs. Sell the rule and
   queue watch, not slots.
2. **Residents and housing co-op boards (4).** Councils stopped sending letters, so the
   alert is now the resident's job; in Norway a nabovarsel to a borettslag goes only to
   the board. One board brief reaches every flat (B2B2C). Start with OBOS, USBL, NBBL.
3. **Small landlords (4).** Pay £13–25/mo for legislation updates today. Lovdata HTU and
   gov.uk are readable. Reach through Huseierne and NRLA.
4. **NGOs, activists and patient groups as teams (4).** Pay £195/mo+ for policy
   monitoring that small groups can't afford. Høringer doc tested 6/6.
5. **Solo professionals (4).** One-person practices with rule duties; a $249/yr
   dental/vet digest and $5k+/yr firm monitors show the price. Reach via professional
   bodies.
6. **Hobbyists with gear that updates (4).** Two tested docs, strong subreddit reach;
   today they rig Visualping ($10/mo) or read 135-page forum threads.
7. **Researchers and grant seekers (4).** Deadline radar; institutions already buy
   Research Professional. NTNU is next door.
8. **Hunters, anglers and farmers (4).** Big associations (NJFF, Bondelaget), money and
   seasons at stake, deadlines move often.
9. **Small investors (4).** Pay $20–30/mo for insider-filing alerts; EDGAR full-text
   search is readable. A filings brief ("what changed at my 5 holdings") beats raw alerts.
10. **Local journalists (4).** Stanford built Agenda Watch for them; Scout adds
    kommune and Brreg. They also amplify Scout.

Next: patients and carers with a rare condition (4, needs Håkon's call on medical
topics), benefit claimants (4, tested), niche job seekers (4, tested).

## Surprises

- **Councils pushed the alert onto residents.** Camden stopped neighbour letters in 2016,
  Dudley in 2024; "sign up for alerts instead". In Norway the board, not the flat, gets
  the nabovarsel. Radius watch for co-op boards is a real gap.
- **Developers hand-build one monitor per niche.** Apify lists paid "monitor" actors for
  ClinicalTrials.gov, SEC Form 4, patents and city councils. The demand is proven; the
  tools only suit developers. Scout is that monitor for everyone else.
- **Niche watchers cost 4–40× Scout's likely price.** Docket Alarm $40/mo, Landlord Law
  £25/mo, PolicyMogul £195/mo, patent name watch £300–600/yr, but generic page-watching
  costs $10/mo (Visualping). Scout sits between: niche judgement at a generic price.
- **The biggest hand-checking pain is the wrong target.** Visa and Bürgeramt slots
  drive bots, Telegram groups and paid services, but they are minute races. Scout should
  watch the rules and queue times around them.
- **A nation runs on saved searches.** India's government-job notice sites: one app has
  5M+ installs. A human-curated Scout, ad-funded.
- **"Status of my case" is mostly behind a login.** Scout can only watch the public
  proxies (waiting times, similar decisions, rule changes); say so in the pitch.
- **Some key official lists are unreadable:** Nye Metoder (JavaScript), SEC's
  browse-edgar (needs a contact user agent), Australia's PlanningAlerts (Cloudflare).

## Rounds

1. The starting list plus evidence searches: 30 groups, 11 watch types.
2. "Who did I miss": other countries' habits (India job notices, Berlin Termin bots, UK
   councils dropping letters), B2B2C (co-op boards, clubs, clinics), teams (NGOs,
   newsrooms). Added 9 groups, 6 watch types.
3. Edges: drone pilots, allergy sufferers, inventors, cabin owners, diaspora, heirs.
   Added 7 groups, 4 watch types.
4. Considered and dropped: bereaved families, emergencies, price hunters, clinics sending
   briefs to patients (overlaps the patient row and the medical risk), schools sending
   briefs to parents (they have SchoolMessenger). Nothing new worth scoring; stopped.
