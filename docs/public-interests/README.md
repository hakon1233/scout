# Public interests: research and how to write them

Research on which public interests Scout should run, and how to write each one so its
runs give good briefs. Start with Trondheim and Norway, then the Nordics, then the
biggest niches elsewhere. The first-users plan is in `../MARKETING.md`.

| File                         | What it holds                                          |
| ---------------------------- | ------------------------------------------------------ |
| [trondheim.md](trondheim.md) | Trondheim sub-niches                                   |
| [norway.md](norway.md)       | Norway-wide sub-niches                                 |
| [nordics.md](nordics.md)     | Sweden, Denmark, Finland, Iceland                      |
| [world.md](world.md)         | Big niches in other countries                          |
| [intent-docs/](intent-docs/) | Ready-to-use intent docs for the best picks, and tests |

## Tested intent docs (20 Nov 2026)

Each was run twice through web search and fetch, scored, fixed and run again.

| Doc                                                                               | Final score | Run how often   |
| --------------------------------------------------------------------------------- | ----------- | --------------- |
| [AtB route changes](intent-docs/atb-route-changes.md)                             | 6/6         | Daily           |
| [Trondheim kids and family events](intent-docs/trondheim-kids-events.md)          | 6/6         | Fridays         |
| [AAP, sykepenger og uføretrygd](intent-docs/aap-sykepenger-ufore.md)              | 6/6         | Weekly          |
| [Bambu Lab firmware and policy](intent-docs/bambu-lab-firmware.md)                | 6/6         | Weekly          |
| [Trondheim council decisions](intent-docs/trondheim-council-decisions.md)         | 5/6         | Weekly          |
| [Norwegian test dates](intent-docs/norwegian-test-dates.md)                       | 5/6         | Every two weeks |
| [UK settlement (ILR)](intent-docs/uk-settlement-ilr.md)                           | 5/6\*       | Weekly          |
| [Home Assistant breaking changes](intent-docs/home-assistant-breaking-changes.md) | 5/6\*       | Weekly          |

\* Doc changed after the run; not re-tested.

## Rules for running them (Håkon, 20 Nov 2026)

- Few public interests run on the API: credits are limited. Each new one gets a few test
  runs, then is switched off until Håkon decides it goes live.
- Test runs can also use the local runner on Håkon's Claude subscription, for testing
  only. Public briefs for real users run on an API key (Anthropic's consumer terms §3(7)
  ban scripted use of a subscription).
- Haiku costs about $0.05 a run, mostly the search fee. 100 daily interests is about
  $150 a month.

## What makes a good niche

- **People keep asking for updates**, and say the news is scattered or missing.
- **The facts sit on public pages Scout can read**: server-rendered, no login, ideally
  dated. Facebook, Instagram, Discord and JavaScript-only sites don't count.
- **The right width.** Narrow enough that every story matters to the reader ("UK
  settlement rules", not "UK immigration"); wide enough that something changes most
  weeks and thousands of people care. Split a niche when readers follow only one part of
  it; merge two when each alone is quiet most weeks.
- **Score 1–5** = how much the community needs it × how badly news serves it now.
  "Inferred" demand is a guess; confirm it before going live.

Tags: ai, dev-tools, open-source, self-hosting, security, gaming, retro, hardware, maker,
smart-home, platform-policy, immigration, travel, tax, housing, work, study, benefits,
regulation, nordic, expat, sports, outdoors, games-tabletop, collectibles, music,
books-fandom, space-science, nature, family, local, events, language, funding, consumer.

Left out on purpose: price and stock tracking (bots do it better), medical topics (too
risky to summarise), topics already well covered by news.

## How to write an intent doc

The doc is free-form Markdown, up to 4,000 characters, put word for word into the run
prompt (`packages/core/src/research-prompt.ts` on the `ideas` branch). Use these sections:

```markdown
# <topic>

## Reader

Who it is for, in one line.

## Report

- What counts as a story, as a bullet list

## Skip

What to ignore.

## Sources, check first

- 2–4 URLs, best first, each with a note on what it holds and where its date is
- Traps to avoid (PDF-only pages, pages the fetch tool can't read)

## Search terms

Terms in the sources' language, phrased like news headlines.

## Each story must state

- The date in backticks, and which date it is (published, updated, event day, deadline)
- E.g. status (proposed / in force), effective date, who it affects, link to the official text

## No change

The exact window ("published or updated in the last 3 days") and the exact line to
write when nothing is new. Don't pad.

## Language and place

E.g. read Norwegian sources, write in English, Norway, Europe/Oslo.
```

Until chief's explicit evergreen flag lands, keep these words out of the doc **and its
URLs** (they match inside slugs like `-release-history`): evergreen, background,
historical, history, retrospective, timeline, explainer, primer, deep dive / deep-dive,
long read / long-read. Any of them switches off the 30-day freshness cutoff
(`EVERGREEN_RE` in `coverage.ts`).

## Lessons from testing eight docs

1. **Check sources with the run's own fetch tool, not curl or a browser.** The tool got a
   402 from the Bambu wiki, only the title from Folkeuniversitetet, and doesn't follow
   redirects. Pages over ~24K characters are cut, so a long release post's key section
   never arrives; give a search route instead.
2. **Prefer compact dated lists:** RSS or Atom, GitHub releases, a department's news
   list, AtB's notice list. Each source costs one of the 5 fetches. Article and notice
   pages often carry no date; the list does.
3. **Find where the date lives and say which date counts.** The shared rules assume a
   publish date; events need the event date, tests the next deadline.
4. **Check how far a server-rendered list reaches.** trdevents shows about two days;
   match how often it runs and the doc's window to what the run can see.
5. **For rule changes, say where status comes from** and allow "status not given". Press
   releases rarely state status or effective date.
6. **Name the reader's money, duties or day; skip the side-effects** (employer-only
   changes, outreach campaigns, one user's bug report, recurring offers).
7. **Widen when the core is quiet, but say what leads** and give a "no change in the core"
   line (AAP leads sykepenger and uføretrygd).
8. **Paywalled news gives a headline and a time only.** Name the official page to confirm
   it, and the label to use when none exists ("paywalled, details unconfirmed").
9. **Make "No change" concrete.** A real window and the exact line. Until run change #2
   lands, this conflicts with the prompt's 2–4 stories.

## Run changes recommended to chief (20 Nov 2026)

Ranked; cost per run stays flat or drops.

1. Feed the last 2 briefs' story titles, URLs and dates into the prompt as "already
   reported".
2. Allow 0–4 stories and an honest "No change since <date>" line; update the
   story-count eval check.
3. Fetch the doc's "Sources, check first" pages before searching.
4. Let a specific event or announcement page count as a story (today `SEARCH_SKILLS`
   rejects event listings).
5. Locale and language per interest; pass `user_location` to web search. No
   `allowed_domains`: it blocks finding other sources.
6. Status and effective date in the story format for rule-change interests.
7. 1–3 paragraph bodies, about 500 words, for niche interests.
8. An explicit evergreen flag per interest, replacing the keyword match.

## Checklist for each test brief (score 0–6, plus coverage)

1. **New:** nothing repeated from earlier briefs unless it says what changed.
2. **Official first:** rule claims link the primary source.
3. **Dated:** every story's date matches the page; rules give status and effective date,
   events give event date and sign-up deadline.
4. **On scope:** every story fits Report; nothing from Skip, no homepages or general news.
5. **Honest when empty:** a quiet week says "No change", not padding.
6. **Right language and place:** found sources in the right language; one fact
   spot-checked against its source.

Then **Coverage**: did the brief miss an on-scope item a person finds in five minutes?
Both Bambu runs scored well on the six checks while missing a stable firmware release.

Run each new interest privately for two weeks, scoring each brief, before it goes public.
