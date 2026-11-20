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

- 3–5 official URLs, checked to load without JavaScript

## Search terms

Terms in the sources' language.

## Each story must state

E.g. status (proposed / in force), effective date, who it affects, link to the official text.

## No change

If nothing is new since the last brief, say so in one line. Don't pad.

## Language and place

E.g. read Norwegian sources, write in English, Norway, Europe/Oslo.
```

Until chief's explicit evergreen flag lands, never use the words "background",
"history", "timeline", "explainer" or "primer" in a doc: today they switch off the 30-day
freshness cutoff (`EVERGREEN_RE` in `coverage.ts`).

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

## Checklist for each test brief (score 0–6)

1. **New:** nothing repeated from earlier briefs unless it says what changed.
2. **Official first:** rule claims link the primary source.
3. **Dated:** every story's date matches the page; rules give status and effective date,
   events give event date and sign-up deadline.
4. **On scope:** every story fits Report; nothing from Skip, no homepages or general news.
5. **Honest when empty:** a quiet week says "No change", not padding.
6. **Right language and place:** found sources in the right language; one fact
   spot-checked against its source.

Run each new interest privately for two weeks, scoring each brief, before it goes public.
