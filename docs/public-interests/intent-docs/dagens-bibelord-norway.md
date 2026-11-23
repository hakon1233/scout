# Dagens bibelord, Norway (tested, works today)

**Width:** one verse reference a day, chosen by Bibelselskapet to follow the church year. Scout
does not choose the verse and does not print its text. It gives the reference, the place of the
passage in the Bible, the church-year season, and a link to read it. Runs daily, early morning.

**Why it works with today's run system:** the source is a dated page that changes every day, so
the freshness check passes and nothing needs to be remembered. A missed day is lost (the page
has no archive list, only "Forrige/Neste").

**Licence rule (read bibel.no/verbum/rettigheter-til-bruk-av-bibeltekst, fetched 23 Nov 2026):**
Bibel 2011 and Bibel 2024 are copyrighted. Quotation is limited to 5 verses; a website or app
needs permission and usually a fee; no AI-picked verses, no AI answers to theological
questions, no changes to the text. Free and public domain: the 1930 bokmål and 1938 nynorsk
translations. So the brief carries the reference and a link, nothing more. If Håkon wants the
text inside the brief, ask the rights editor at Bibelselskapet first, or use the 1930 text.

**Score:** run 1 (by hand, 23 Nov 2026) 6/6. Coverage: nothing to miss; one verse a day.

## Intent doc

```markdown
# Dagens bibelord

## Reader

A Norwegian reader who wants the Church of Norway's verse of the day, with a little context, each morning.

## Report

- Today's "Dagens bibelord" reference (book, chapter, verses), exactly as the source gives it
- Where the passage sits: which book, which part of the Bible, and the church-year season if the page says so
- One neutral line on what kind of text it is (psalm, letter, narrative, law, saying). No interpretation, no advice, no "what it means for you"

## Skip

The verse text itself, sermons, devotionals, theological opinions, podcasts, and any verse not on the source page.

## Sources, check first

- https://bibel.no/dagens-bibelord : Bibelselskapet's page. The date is at the top ("23. november 2026"), then the reference in bokmål, nynorsk and nordsamisk. "Forrige" and "Neste" links; no archive list. Verses follow the church year.
- https://www.kirken.no/nb-NO/kristen-tro/dagens%20bibelord/ : the same verse on kirken.no, headed "Dagens bibelord" with the date; credited to bibel.no.

Traps: kirken.no/nb-NO/om-troen/kirkearet/ is a 404 and the Tekstbok PDFs are not readable by the fetch tool. Do not search for commentary to add.

## Search terms

None needed. If both pages fail: Dagens bibelord bibel.no, kirken.no dagens bibelord.

## Each story must state

- The page date in backticks
- The reference, and the link to https://bibel.no/dagens-bibelord
- No quoted Bible text, not even a few words

## No change

If the page date is not today, write: "Dagens bibelord for <date> is not out yet." Do not guess a verse or repeat yesterday's.

## Language and place

Read and write Norwegian bokmål. Norway, Europe/Oslo.
```

## Test notes

- Run 1 (23 Nov 2026): kirken.no front page links "Dagens bibelord"; its page is dated
  23.11.2026, Job 28,20-28, credited "Kilde: www.bibel.no", no archive, no licence text. bibel.no
  front page and /dagens-bibelord show the same reference with the same date, three language
  versions, a daily e-mail (about 15,000 readers) and a podcast with a new episode at 05:00. Spot
  check: reference matched on both sites. Hand-written brief: `23 Nov 2026`, Job 28,20-28, "a
  wisdom poem in the book of Job (poetry and wisdom writings)", link. Passes the six checks.
- Search found only English commentary on the passage, so the doc says not to search.
- A "verse and a short reflection" brief is the thing readers expect, but Bibelselskapet bans AI
  theological choices and answers in apps. Keep the reflection out unless they agree.
