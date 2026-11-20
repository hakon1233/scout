# Marketing: first users

The plan for getting Scout its first users for free. Full write-up with sources:
<https://claude.ai/artifact/5c5Dkzf93Ss46auugaiUoy> (private to Håkon).

## Decisions (Håkon, 20 Nov 2026)

- **Trondheim first, Show HN later.** Win NTNU and Trondheim by hand while the hosted
  public brief pages get built. Show HN only once a brief page works without login.
- **Public interests are not running yet.** The topics below are set up later, and run
  privately for two weeks to check quality before anyone sees them.
- **Google indexes only a few curated public interests.** The rest are `noindex`. Google's
  spam policy names mass AI-generated pages, and a penalty hits the whole site.
- **Which organiser to pitch first is still open.** Nothing goes out without Håkon's OK on
  the wording.

## What the hosted product needs for this

- A public brief page anyone can read without logging in.
- A "Make your own brief" button on every shared brief and brief email.
- Following a public or shared interest by email, without a Google login.

## Public interests to set up

★ marks the five to run first. Every topic is one where people keep asking for updates,
news covers it badly, and the sources are public pages Scout can read.

| Topic                                        | Community it serves                          | Cadence | Main sources                                                    |
| -------------------------------------------- | -------------------------------------------- | ------- | --------------------------------------------------------------- |
| ★ LLM releases, prices, retirements          | r/LocalLLaMA, developers using LLM APIs      | Daily   | Vendor changelogs and pricing pages, Hugging Face               |
| ★ Home Assistant breaking changes            | r/homeassistant, community.home-assistant.io | Weekly  | home-assistant.io/blog, GitHub releases                         |
| ★ EU entry rules (EES / ETIAS)               | r/travel, non-EU travellers                  | Weekly  | travel-europe.europa.eu, Frontex                                |
| ★ UDI waiting times and rules                | r/Norway, expats in Norway                   | Weekly  | udi.no case-type pages                                          |
| ★ Trondheim student events this week         | NTNU students, r/ntnu                        | Weekly  | See "Trondheim event sources" below                             |
| AI coding tools: limits and changes          | r/ClaudeAI, r/cursor, r/ChatGPTCoding        | Daily   | Public changelogs and docs                                      |
| Self-hosted app security advisories          | r/selfhosted                                 | Weekly  | GitHub advisories, OSV, CISA KEV                                |
| H-1B and USCIS policy changes                | r/h1b, r/USCIS, r/immigration                | Daily   | uscis.gov, Federal Register                                     |
| EU AI Act deadlines and guidance             | EU startups, compliance teams                | Weekly  | EUR-Lex, the AI Office, law-firm blogs                          |
| Norwegian research and startup funding calls | NTNU researchers, Norwegian founders         | Weekly  | forskningsradet.no (parts of innovasjonnorge.no block fetches)  |
| Lånekassen and NAV rules for students        | r/norge, r/ntnu                              | Weekly  | lanekassen.no (nav.no is heavy on JavaScript)                   |
| Nordic AI PhD and postdoc openings           | r/PhD, r/academia                            | Weekly  | University job pages (Jobbnorge and EURAXESS are hard to fetch) |
| Slay the Spire 2 early-access updates        | r/slaythespire                               | Weekly  | Steam news, Mega Crit. A template for other early-access games  |
| Trondheim startup and tech events            | Start NTNU, Spark\* NTNU, founders           | Weekly  | startntnu.no, Trondheim Tech Port, Meetup                       |
| Trondheim festivals and volunteer calls      | Students and residents                       | Weekly  | isfit.org, uka.no, trdevents.no                                 |

Left out: drug shortages (medically risky to summarise), GPU and Steam Deck restocks
(bots do it better), conference CFP deadlines (aideadlin.es covers them), SiT housing
(sit.no blocks fetches), electricity prices (Norwegian media cover them heavily).

## More niches (research, 20 Nov 2026)

A wider list of niches for later public interests. Full table with communities and
cadence: <https://claude.ai/artifact/Tjm6uJ985vg3DAVB7Ev2JQ> (private to Håkon). Score is
need times how badly news serves it, out of 5. Reddit demand is inferred, not yet
checked by hand.

- **Score 5:** UK settlement (ILR) rules; Canada IRCC processing; Swedish work permits and
  citizenship; DJI and drone rules; Bambu Lab firmware and policy; open-source relicensing
  and rug-pulls; climbing competitions and access.
- **Immigration and moving (4):** digital nomad visas; Danish immigration and tax; UK
  Skilled Worker and care visas; Portugal and Spain residency; student visas UK/CA/AU.
- **Work, tax, housing (4):** Norwegian tax for newcomers; UK Renters' Rights Act;
  foreign nurse registration; doctors' licensing abroad.
- **Tech (4):** npm and PyPI supply-chain attacks; MCP servers and agent frameworks; local
  LLM tools; ComfyUI; GrapheneOS and custom ROMs; app store rules and sideloading;
  Fediverse and Bluesky protocol; Flipper Zero firmware.
- **Games and retro (4):** emulator releases; retro handheld firmware; MiSTer FPGA cores;
  mods broken by game patches.
- **Sports and outdoors (4):** trail and ultra running; orienteering; cross-country skiing;
  Norway trail, hut and ski-track closures; US national park rules.
- **Hobbies and fandom (4):** board game Kickstarter updates per game line; TCG ban lists
  and set releases; anime and manga licensing.
- **Score 3, later:** pilot licence conversion, US expat tax, EU VAT for small sellers,
  GDPR enforcement, freelancer rules, UK benefits, Norway and US EV rules, academic job
  market, Proxmox/TrueNAS/Unraid, Matter and Thread, Steam Deck, Bazzite, PoE2, avalanche
  season, fishing rules, chess, women's football, space launches, birding rarities,
  invasive plant bans, author release news, genre tours, Norwegian parents' rules.

Tags: ai, dev-tools, open-source, self-hosting, security, gaming, retro, hardware, maker,
smart-home, platform-policy, immigration, travel, tax, housing, work, study, benefits,
regulation, nordic, expat, sports, outdoors, games-tabletop, collectibles, music,
books-fandom, space-science, nature, family, local, events.

Left out: price and stock tracking (bots do it better), topics that live only on Discord,
Facebook or Instagram, medical topics, and well-served news (Linux kernel, Raspberry Pi,
general AI news).

**Running them:** public briefs run on an API key (Haiku, about $0.05 a run, about $150 a
month for 100 daily interests). Håkon's Claude subscription is for testing only:
Anthropic's consumer terms §3(7) ban scripted use of a subscription.

## Trondheim event sources

- **Scout can read:** Samfundet (samfundet.no/arrangement), TIHLDE (tihlde.org/arrangementer),
  the Abakus API (lego.abakus.no/api/v1/events/), Start NTNU, ISFiT, UKA, trdevents.no.
  Together these cover about 60–70% of student events.
- **Scout can't read today:** Online (online.ntnu.no) and the NTNU calendar load their
  events by JavaScript; Facebook and Instagram need a login. Many linjeforeninger and
  ESN Trondheim post mainly there.

## Organisers to pitch

None chosen yet. Candidates, with why each would want more attendees:

- **ESN Trondheim:** reaches international students that Norwegian channels miss. Posts
  its calendar mostly on Instagram, so Scout would fill a real gap.
- **Start NTNU:** founder crowd that fits Scout. Lists events months ahead (Start
  HealthTech, 4–5 Mar 2027).
- **ISFiT:** big festival in Feb 2027 with open events and host recruitment.
- **Samfundet:** its small concerts and talks, not the shows that sell out.
- **Trondheim Dokumentarfestival:** a short festival window each year (27 Nov 2026).

Company presentations at Abakus and Online usually fill up already; skip them.

## Channels after Trondheim

1. Show HN, linking straight to a public brief page. No asking anyone for upvotes.
2. GitHub README with a GIF and a sample brief link, awesome-lists, AlternativeTo (as an
   alternative to Google Alerts and Feedly).
3. Topic subreddits: take part for 2–4 weeks before posting a useful brief, never the same
   link across many subs.
4. Product Hunt only once there are real users.
