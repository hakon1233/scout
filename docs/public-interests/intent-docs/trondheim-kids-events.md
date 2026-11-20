# Trondheim kids and family events this week (tested)

**Width:** narrowed to one-off and free events for ages 0–12. The family category lists
about 100 events; without a filter the brief is just the first four.

**Score:** run 1 5/6 (a weekly "every weekend" offer would repeat) → run 2 6/6. Caveat:
the server-rendered list shows only ~12 events (about 2 days ahead); date filters and
"load more" need JavaScript. **Run it on Fridays as a weekend brief.**

## Intent doc

```markdown
# Trondheim kids and family events this week

## Reader

Parents in Trondheim with children aged 0–12 who want a short list of good, one-off things to do in the next 7 days.

## Report

Each story is one event page. Pick up to 4, in this order:

- One-off events (one date, or a few dates in a single weekend)
- Free events (gratis) before paid ones
- A new show's opening weekend, or a seasonal event (Christmas workshop, holiday programme)
- Events that need booking, so parents can act in time

## Skip

- Weekly or "every weekend" offers (open hours at a museum, baby play groups, swim or skating schools)
- Shows with many dates already reported in an earlier brief
- Events for adults only, and events outside Trondheim
- The listing page itself: it only points to events

## Sources, check first

- https://trdevents.no/category/barn-familie : family events, soonest first. Server-rendered list shows only the next one or two days; follow its event links.
- https://trdevents.no/ : the front page highlights bigger events later in the week; keep the ones for children.
- https://litteraturhusetitrondheim.no/program : talks and readings for children (Barnas Basta).

Open each event page (trdevents.no/arrangement/...) before you report it: it states the date, time, venue, age, price and booking link.

## Search terms

barn og familie Trondheim helg, gratis for barn Trondheim, familieforestilling Trondheim, juleverksted Trondheim

## Each story must state

- The date in backticks: the EVENT date (not a publish date); for a run of dates, the first date in the coming 7 days
- Time and venue
- Age group, if given
- Price or "free"
- Booking: needed or not, where, and any deadline
- Link to the event page

## No change

There is almost always something. If no one-off event for children is listed in the next 7 days, write one line: "No one-off family events found for <dates>." Don't fill with weekly offers.

## Language and place

Read Norwegian sources, write in English. Keep event titles in Norwegian. Trondheim, Europe/Oslo.
```

## Test notes

- trdevents' GraphQL API needs a POST or a special header the fetch tool can't send. If
  chief wants a full week, a small server-side fetch of that API is the fix (Code).
- Run 2 brief: free Christmas workshop at Kristiansten 28 Nov 12–16 (spot-checked),
  Dukkene som ville danse at Brovakten (ages 3–6), two free Barnas Basta talks.
- Web search found nothing useful (Bergen, Oslo or past events); the sources do the work.
