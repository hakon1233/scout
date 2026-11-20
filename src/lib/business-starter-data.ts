// The business starter pack as data: the trades a reader can pick at
// sign-up, the intent-doc templates each trade's topics come from, and
// Norway's kommuner (brreg's kommune numbers, 2026). business-starter.ts
// fills a template; nothing here is code per trade.
//
// Sources: docs/public-interests/business-more.md (the starter pack per
// trade and the tested intent docs) and intent-docs/norway-import-costs.md.
// A {name} in a template is filled from the trade's vars plus {kommune} and
// {kommunenummer}; a trade var may itself use {kommune}. Every filled doc
// must fit the free plan's 4,000 characters (business-starter.test.ts).
// Source note kept in the docs: brreg's kommune filter matches the head
// office, so each list says to check the address.

export type TemplateId = "rivals" | "rules" | "import-costs";

export type Template = { topic: string; doc: string };

export type Trade = {
  id: string;
  // What the reader picks under "What do you do?".
  label: string;
  // Saved as the profile's "What you do" when that is empty.
  role: string;
  topics: TemplateId[];
  vars: Record<string, string>;
};

export const TEMPLATES: Record<TemplateId, Template> = {
  rivals: {
    topic: "New {places} and closures in {kommune}",
    doc: `# New {places} and closures in {kommune}

## Reader

{owner} in {kommune}, who wants to know which {places} open and close in the kommune each week.

## Report

- New {places} registered in {kommune} (new sub-units in brreg)
- {places} in {kommune} that went bankrupt or were wound up by force (a "KONKURSBO" or "TVANGSAVVIKLINGSBO" unit is registered for the estate)

## Skip

- {skip}
- Places outside {kommune} kommune: the brreg lists include some whose head office is in {kommune}, so check the address
- Holding companies and name changes with the same address and owner
- Re-registrations of places already open: several units of one owner registered the same day, or an oppstartsdato months before the registration. Give them one line, "re-registered, not new", or skip them
- Reviews, opening-party news, chains' press releases

## Sources, check first

- https://data.brreg.no/enhetsregisteret/api/underenheter?kommunenummer={kommunenummer}&naeringskode={naeringskode}&sort=registreringsdatoEnhetsregisteret,desc&size=30 (JSON, newest registrations first: navn, registreringsdatoEnhetsregisteret, oppstartsdato, naeringskode1, beliggenhetsadresse). {codes}. Keep only places whose beliggenhetsadresse.kommune is {kommune}.
- https://data.brreg.no/enhetsregisteret/api/enheter?navn=konkursbo&kommunenummer={kommunenummer}&naeringskode={naeringskode}&sort=registreringsdatoEnhetsregisteret,desc&size=20 (JSON, bankruptcy estates newest first; the estate registers within days of the konkurs; this list also lets in other kommuner: check the postnummer)

## Search terms

Use search only to name a place's business or say if a bankrupt firm still trades: "<name>" {kommune} åpner; "<name>" konkurs {kommune}. Local papers are often paywalled: headline and time only.

## Each story must state

- Name, street address and type ({types})
- Opened or closed, and the date in backticks (brreg registration date; also oppstartsdato if given; konkursbo registration date for closures)
- Link to https://virksomhet.brreg.no/nb/oppslag/underenheter/<org number> or /enheter/<org number>

Group: one story for openings, one for closures (a line each). Konkursbo units also appear in the first list: report them only as closures.

## No change

Report registrations dated in the last 7 days; on the first brief (no earlier brief given), the last 14 days. If none, write "No new or closed {places} in {kommune} registered since <date>." Don't pad.

## Language and place

Read Norwegian. Write in English. {kommune}, Norway, Europe/Oslo.`,
  },
  rules: {
    topic: "New rules for {places} in Norway",
    doc: `# New rules for {places} in Norway

## Reader

{owner} in {kommune}, who wants to know which new rules change their costs, duties or opening hours.

## Report

- New or changed forskrifter that reach {places}: {rules}
- Proposals out for høring on the same topics, with the høring deadline
- Notices from {agencies} aimed at {places}: inspection campaigns, new demands
{local}

## Skip

- Rules for other trades, unless they also reach {places}
- One firm's own case, award or closure
- Advice pages with no change

## Sources, check first

- https://lovdata.no/register/forskrifter (new central forskrifter, newest first, 20 a page; the date is in the id: FOR-2026-11-18-2389 = 18 Nov 2026; the ministry is under each). Most are off-topic: read titles and keep only the topics above. Items are at https://lovdata.no/dokument/LTI/forskrift/<yyyy-mm-dd-nnnn>.
- https://www.regjeringen.no/no/dokument/hoyringar/id1763/ (open høringer from all ministries, newest first, each with "Høringsfrist"; most are off-topic)
{sources}
- Read the item itself before reporting: a title like "endring i merverdiavgiftsforskriften" may only cover a narrow case.

## Search terms

{search}

## Each story must state

- What changes for {a_firm}, in one line
- Status: proposed (høring, with deadline), decided, or in force; write "status not given" if the page doesn't say
- The date in backticks and which date it is (published, decided, in force from, høring deadline)
- Link to the official text (Lovdata, regjeringen, the agency, the kommune) first; news second

## No change

Report items published or decided in the last 7 days; on the first brief (no earlier brief given), the last 30 days. If none, write "No new rules for {places} since <date>." Don't pad with older rules or advice pages.

## Language and place

Read Norwegian. Write in English. Norway, Europe/Oslo.`,
  },
  "import-costs": {
    topic: "Import costs for a Norwegian online shop or wholesaler",
    doc: `# Import costs for a Norwegian online shop or wholesaler

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
`,
  },
};

const ARBEIDSTILSYNET =
  "- https://www.arbeidstilsynet.no/nyheter/ (Arbeidstilsynet news, dated)";
const TOLL =
  "- https://www.toll.no/no/bedrift/nyheter-for-naeringslivet (Tolletaten news for businesses, dated DD.MM.YYYY; relative links, prefix https://www.toll.no)";
const lovdataFor = (ministry: string) =>
  `- https://lovdata.no/register/forskrifter?ministry=${ministry} (only ${ministry}'s new forskrifter)`;

export const TRADES: Trade[] = [
  {
    id: "restaurant",
    label: "Restaurant, café or bar",
    role: "Runs a restaurant, café or bar",
    topics: ["rivals", "rules"],
    vars: {
      places: "restaurants, cafés and bars",
      owner: "The owner of a restaurant, café or bar",
      a_firm: "a restaurant",
      naeringskode: "56",
      codes: "Code 56.1 = restaurants and cafés, 56.2 = catering, 56.3 = bars",
      types: "restaurant, café, bar",
      skip: "Catering-only firms, food trucks and festival stands",
      rules:
        "food hygiene, allergen and origin labelling, alcohol and skjenking, MVA and særavgift on food and drink, minimum wage (allmenngjort lønn) in serving, working hours, internkontroll, cash registers (kassasystem)",
      agencies: "Arbeidstilsynet or Mattilsynet",
      local:
        "- {kommune} kommune decisions on skjenketider, skjenkebevilling, outdoor serving (uteservering) or fees",
      sources: `${ARBEIDSTILSYNET}
- Mattilsynet's rules arrive as Lovdata forskrifter; its news list (undated) and høringer page (JavaScript) don't work: skip them.`,
      search:
        "skjenketider {kommune}; skjenkebevilling {kommune}; allmenngjøring overnatting og servering. Use a hit only if it is dated in the window.",
    },
  },
  {
    id: "builder",
    label: "Builder, electrician or plumber",
    role: "Runs a building or installation firm",
    topics: ["rivals", "rules"],
    vars: {
      places: "building and installation firms",
      owner: "The owner of a building, electrical or plumbing firm",
      a_firm: "a building firm",
      naeringskode: "41,43",
      codes:
        "Code 41 = construction of buildings, 43 = specialised trades such as electrical, plumbing and finishing work",
      types: "builder, electrician, plumber, other trade",
      skip: "Sole traders registered at a home address, unless the reader works with them",
      rules:
        "building regulations (TEK, byggesaksforskriften), product documentation, minimum wage (allmenngjort lønn) in building and electrical work, HMS cards, working hours, public procurement rules",
      agencies: "Arbeidstilsynet or DiBK",
      local: "",
      sources: ARBEIDSTILSYNET,
      search:
        "TEK17 endring; DiBK høring; allmenngjøring byggeområder. Use a hit only if it is dated in the window.",
    },
  },
  {
    id: "ecommerce",
    label: "Online shop",
    role: "Runs an online shop",
    topics: ["import-costs", "rules"],
    vars: {
      places: "online shops",
      owner: "The owner of a small online shop",
      a_firm: "an online shop",
      rules:
        "distance sales and VOEC, customs and fees on parcels, consumer purchase and marketing law, product safety (GPSR), packaging (PPWR) and return schemes, MVA",
      agencies: "Tolletaten, Forbrukertilsynet or Skatteetaten",
      local: "",
      sources: TOLL,
      search:
        "kontrollgebyr fjernsalg; GPSR nettbutikk; Forbrukertilsynet nettbutikk",
    },
  },
  {
    id: "importer",
    label: "Importer or wholesaler",
    role: "Runs an import or wholesale firm",
    topics: ["import-costs", "rules"],
    vars: {
      places: "importers and wholesalers",
      owner: "The owner of an import or wholesale firm",
      a_firm: "an importer",
      rules:
        "toll and customs procedures, MVA and særavgifter, EU product rules that reach importers (EUDR, PPWR packaging, Ecodesign, CBAM), product documentation",
      agencies: "Tolletaten or Skatteetaten",
      local: "",
      sources: TOLL,
      search:
        "EUDR importør Norge; CBAM Norge; statsbudsjettet avgift import (check the budget year)",
    },
  },
  {
    id: "salon",
    label: "Hairdresser or beauty salon",
    role: "Runs a hair or beauty salon",
    topics: ["rivals", "rules"],
    vars: {
      places: "hair and beauty salons",
      owner: "The owner of a hair or beauty salon",
      a_firm: "a salon",
      naeringskode: "96.2",
      codes: "Code 96.2 = hairdressers, barbers, beauty salons and spas",
      types: "hairdresser, barber, beauty salon",
      skip: "Mobile or home-based sole traders with no salon address",
      rules:
        "cosmetics and treatment rules, hygiene for tattoo, piercing and skin treatments, MVA and tax for small firms, cash registers (kassasystem), working hours",
      agencies: "Mattilsynet, Helsedirektoratet or Arbeidstilsynet",
      local: "",
      sources: ARBEIDSTILSYNET,
      search: "frisør nye regler; kosmetikkforskriften endring",
    },
  },
  {
    id: "accounting",
    label: "Accounting firm",
    role: "Runs an accounting firm",
    topics: ["rules"],
    vars: {
      places: "accountants and their small-firm clients",
      owner: "An accountant with small AS and sole-trader clients",
      a_firm: "a client firm",
      rules:
        "tax, MVA and fee changes for small AS and sole traders, bookkeeping and annual accounts rules, A-melding and reporting duties, the state budget's tax changes",
      agencies: "Skatteetaten, Brønnøysundregistrene or Finanstilsynet",
      local: "",
      sources: lovdataFor("Finansdepartementet"),
      search:
        "skatteendringer små bedrifter; MVA endring; bokføringsforskriften endring (check the year)",
    },
  },
  {
    id: "transport",
    label: "Transport, haulage or taxi",
    role: "Runs a transport firm",
    topics: ["rivals", "rules"],
    vars: {
      places: "transport and taxi firms",
      owner: "The owner of a haulage or taxi firm",
      a_firm: "a transport firm",
      naeringskode: "49.3,49.4",
      codes:
        "Code 49.3 = taxi and other passenger transport, 49.4 = freight by road",
      types: "haulage, taxi, other transport",
      skip: "Single-car taxi sole traders, unless the reader runs taxis",
      rules:
        "road transport rules (kabotasje, drivers' hours, tachographs, tolls), taxi løyver, minimum wage (allmenngjort lønn) in goods transport, fuel and road-use taxes",
      agencies: "Statens vegvesen or Arbeidstilsynet",
      local: "",
      sources: `${lovdataFor("Samferdselsdepartementet")}
${ARBEIDSTILSYNET}`,
      search:
        "kabotasje regler; allmenngjøring godstransport; drosjeløyve endring",
    },
  },
  {
    id: "fishing",
    label: "Fishing boat",
    role: "Runs a fishing boat",
    topics: ["rules"],
    vars: {
      places: "fishing boats",
      owner: "The owner of a coastal fishing boat",
      a_firm: "a fishing boat",
      rules:
        "quotas and regulations for the coastal fleet, landing and catch reporting, gear and area closures, fish buyers' rules",
      agencies: "Fiskeridirektoratet",
      local: "",
      sources: `${lovdataFor("Nærings- og fiskeridepartementet")}; quota rules are busiest November to February`,
      search: "J-melding kystflåten; Fiskeridirektoratet regulering",
    },
  },
  {
    id: "farm",
    label: "Farm",
    role: "Runs a farm",
    topics: ["rules"],
    vars: {
      places: "farms",
      owner: "A farmer",
      a_firm: "a farm",
      rules:
        "produksjonstilskudd and its deadlines, animal health and welfare, plant health, grants for farm investments, food production rules",
      agencies: "Landbruksdirektoratet or Mattilsynet",
      local: "",
      sources: lovdataFor("Landbruks- og matdepartementet"),
      search: "produksjonstilskudd frist; Landbruksdirektoratet nyheter",
    },
  },
  {
    id: "clinic",
    label: "Dentist, doctor or clinic",
    role: "Runs a clinic",
    topics: ["rivals", "rules"],
    vars: {
      places: "clinics",
      owner: "The owner of a dental or medical clinic",
      a_firm: "a clinic",
      naeringskode: "86.2",
      codes:
        "Code 86.21 = general practice, 86.22 = specialists, 86.23 = dentists",
      types: "dentist, doctor, specialist",
      skip: "Clinics inside hospitals and public health stations",
      rules:
        "HELFO refunds and takster, patient records and privacy, professional authorisation, infection control, Helsedirektoratet guidelines",
      agencies: "Helsedirektoratet, HELFO or Datatilsynet",
      local: "",
      sources: `- https://www.helsedirektoratet.no/nyheter (Helsedirektoratet news, dated)
${lovdataFor("Helse- og omsorgsdepartementet")}`,
      search: "HELFO takster; tannlege nye regler",
    },
  },
  {
    id: "hotel",
    label: "Hotel or guesthouse",
    role: "Runs a hotel or guesthouse",
    topics: ["rivals", "rules"],
    vars: {
      places: "hotels and guesthouses",
      owner: "The owner of a hotel or guesthouse",
      a_firm: "a hotel",
      naeringskode: "55.1",
      codes: "Code 55.1 = hotels and similar accommodation",
      types: "hotel, guesthouse",
      skip: "Single flats let on Airbnb by private owners",
      rules:
        "accommodation rules, tourist tax (besøksbidrag), minimum wage (allmenngjort lønn) in overnatting, fire safety, alcohol and skjenking, short-term rental rules, MVA",
      agencies: "Arbeidstilsynet or the kommune",
      local:
        "- {kommune} kommune decisions on besøksbidrag, skjenking or short-term rentals",
      sources: ARBEIDSTILSYNET,
      search: "besøksbidrag {kommune}; allmenngjøring overnatting og servering",
    },
  },
];

// "<kommunenummer> <name>", one per line. Herøy and Våler each name two
// kommuner, so they carry their county.
export const KOMMUNER = `
0301 Oslo
1101 Eigersund
1103 Stavanger
1106 Haugesund
1108 Sandnes
1111 Sokndal
1112 Lund
1114 Bjerkreim
1119 Hå
1120 Klepp
1121 Time
1122 Gjesdal
1124 Sola
1127 Randaberg
1130 Strand
1133 Hjelmeland
1134 Suldal
1135 Sauda
1144 Kvitsøy
1145 Bokn
1146 Tysvær
1149 Karmøy
1151 Utsira
1160 Vindafjord
1505 Kristiansund
1506 Molde
1508 Ålesund
1511 Vanylven
1514 Sande
1515 Herøy (Møre og Romsdal)
1516 Ulstein
1517 Hareid
1520 Ørsta
1525 Stranda
1528 Sykkylven
1531 Sula
1532 Giske
1535 Vestnes
1539 Rauma
1547 Aukra
1554 Averøy
1557 Gjemnes
1560 Tingvoll
1563 Sunndal
1566 Surnadal
1573 Smøla
1576 Aure
1577 Volda
1578 Fjord
1579 Hustadvika
1580 Haram
1804 Bodø
1806 Narvik
1811 Bindal
1812 Sømna
1813 Brønnøy
1815 Vega
1816 Vevelstad
1818 Herøy (Nordland)
1820 Alstahaug
1822 Leirfjord
1824 Vefsn
1825 Grane
1826 Hattfjelldal
1827 Dønna
1828 Nesna
1832 Hemnes
1833 Rana
1834 Lurøy
1835 Træna
1836 Rødøy
1837 Meløy
1838 Gildeskål
1839 Beiarn
1840 Saltdal
1841 Fauske
1845 Sørfold
1848 Steigen
1851 Lødingen
1853 Evenes
1856 Røst
1857 Værøy
1859 Flakstad
1860 Vestvågøy
1865 Vågan
1866 Hadsel
1867 Bø
1868 Øksnes
1870 Sortland
1871 Andøy
1874 Moskenes
1875 Hamarøy
3101 Halden
3103 Moss
3105 Sarpsborg
3107 Fredrikstad
3110 Hvaler
3112 Råde
3114 Våler (Østfold)
3116 Skiptvet
3118 Indre Østfold
3120 Rakkestad
3122 Marker
3124 Aremark
3201 Bærum
3203 Asker
3205 Lillestrøm
3207 Nordre Follo
3209 Ullensaker
3212 Nesodden
3214 Frogn
3216 Vestby
3218 Ås
3220 Enebakk
3222 Lørenskog
3224 Rælingen
3226 Aurskog-Høland
3228 Nes
3230 Gjerdrum
3232 Nittedal
3234 Lunner
3236 Jevnaker
3238 Nannestad
3240 Eidsvoll
3242 Hurdal
3301 Drammen
3303 Kongsberg
3305 Ringerike
3310 Hole
3312 Lier
3314 Øvre Eiker
3316 Modum
3318 Krødsherad
3320 Flå
3322 Nesbyen
3324 Gol
3326 Hemsedal
3328 Ål
3330 Hol
3332 Sigdal
3334 Flesberg
3336 Rollag
3338 Nore og Uvdal
3401 Kongsvinger
3403 Hamar
3405 Lillehammer
3407 Gjøvik
3411 Ringsaker
3412 Løten
3413 Stange
3414 Nord-Odal
3415 Sør-Odal
3416 Eidskog
3417 Grue
3418 Åsnes
3419 Våler (Innlandet)
3420 Elverum
3421 Trysil
3422 Åmot
3423 Stor-Elvdal
3424 Rendalen
3425 Engerdal
3426 Tolga
3427 Tynset
3428 Alvdal
3429 Folldal
3430 Os
3431 Dovre
3432 Lesja
3433 Skjåk
3434 Lom
3435 Vågå
3436 Nord-Fron
3437 Sel
3438 Sør-Fron
3439 Ringebu
3440 Øyer
3441 Gausdal
3442 Østre Toten
3443 Vestre Toten
3446 Gran
3447 Søndre Land
3448 Nordre Land
3449 Sør-Aurdal
3450 Etnedal
3451 Nord-Aurdal
3452 Vestre Slidre
3453 Øystre Slidre
3454 Vang
3901 Horten
3903 Holmestrand
3905 Tønsberg
3907 Sandefjord
3909 Larvik
3911 Færder
4001 Porsgrunn
4003 Skien
4005 Notodden
4010 Siljan
4012 Bamble
4014 Kragerø
4016 Drangedal
4018 Nome
4020 Midt-Telemark
4022 Seljord
4024 Hjartdal
4026 Tinn
4028 Kviteseid
4030 Nissedal
4032 Fyresdal
4034 Tokke
4036 Vinje
4201 Risør
4202 Grimstad
4203 Arendal
4204 Kristiansand
4205 Lindesnes
4206 Farsund
4207 Flekkefjord
4211 Gjerstad
4212 Vegårshei
4213 Tvedestrand
4214 Froland
4215 Lillesand
4216 Birkenes
4217 Åmli
4218 Iveland
4219 Evje og Hornnes
4220 Bygland
4221 Valle
4222 Bykle
4223 Vennesla
4224 Åseral
4225 Lyngdal
4226 Hægebostad
4227 Kvinesdal
4228 Sirdal
4601 Bergen
4602 Kinn
4611 Etne
4612 Sveio
4613 Bømlo
4614 Stord
4615 Fitjar
4616 Tysnes
4617 Kvinnherad
4618 Ullensvang
4619 Eidfjord
4620 Ulvik
4621 Voss
4622 Kvam
4623 Samnanger
4624 Bjørnafjorden
4625 Austevoll
4626 Øygarden
4627 Askøy
4628 Vaksdal
4629 Modalen
4630 Osterøy
4631 Alver
4632 Austrheim
4633 Fedje
4634 Masfjorden
4635 Gulen
4636 Solund
4637 Hyllestad
4638 Høyanger
4639 Vik
4640 Sogndal
4641 Aurland
4642 Lærdal
4643 Årdal
4644 Luster
4645 Askvoll
4646 Fjaler
4647 Sunnfjord
4648 Bremanger
4649 Stad
4650 Gloppen
4651 Stryn
5001 Trondheim
5006 Steinkjer
5007 Namsos
5014 Frøya
5020 Osen
5021 Oppdal
5022 Rennebu
5025 Røros
5026 Holtålen
5027 Midtre Gauldal
5028 Melhus
5029 Skaun
5031 Malvik
5032 Selbu
5033 Tydal
5034 Meråker
5035 Stjørdal
5036 Frosta
5037 Levanger
5038 Verdal
5041 Snåsa
5042 Lierne
5043 Røyrvik
5044 Namsskogan
5045 Grong
5046 Høylandet
5047 Overhalla
5049 Flatanger
5052 Leka
5053 Inderøy
5054 Indre Fosen
5055 Heim
5056 Hitra
5057 Ørland
5058 Åfjord
5059 Orkland
5060 Nærøysund
5061 Rindal
5501 Tromsø
5503 Harstad
5510 Kvæfjord
5512 Tjeldsund
5514 Ibestad
5516 Gratangen
5518 Lavangen
5520 Bardu
5522 Salangen
5524 Målselv
5526 Sørreisa
5528 Dyrøy
5530 Senja
5532 Balsfjord
5534 Karlsøy
5536 Lyngen
5538 Storfjord
5540 Kåfjord
5542 Skjervøy
5544 Nordreisa
5546 Kvænangen
5601 Alta
5603 Hammerfest
5605 Sør-Varanger
5607 Vadsø
5610 Karasjok
5612 Kautokeino
5614 Loppa
5616 Hasvik
5618 Måsøy
5620 Nordkapp
5622 Porsanger
5624 Lebesby
5626 Gamvik
5628 Tana
5630 Berlevåg
5632 Båtsfjord
5634 Vardø
5636 Nesseby`;
