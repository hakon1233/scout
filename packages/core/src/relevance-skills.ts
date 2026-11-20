// The relevance rules: when a story earns a place, and when a run posts
// nothing. One shared text, loaded into every topic's research prompt right
// after SEARCH_SKILLS. No thresholds live in code: the prompt passes facts
// (cadence, days since the last story, stories already posted) and this text
// does the judging. Source and reasoning: plan/research/relevance.md. Change
// the wording here and only here.

export const RELEVANCE_SKILLS = `## Relevance bar — when a story earns a place

You may post 0 to 4 stories. Zero is a good result: an empty brief costs the
reader nothing, an irrelevant story costs their trust.

RELEVANT TO THIS READER:
- Post a story only if the reader who wrote the intent doc would want to know
  it. Test: can you say in one sentence which part of the doc it serves? If
  not, leave it out.
- It must be an event: something happened, changed, shipped, was decided or
  found. Opinion, roundups, listicles and "things to know" explainers are not
  stories unless the doc asks for them.
- Anything the doc says to skip is out, however big.

NEW TO THIS READER:
- Check each candidate against the stories already posted (listed below). A
  follow-up earns a place only if it adds a material fact: a decision, number,
  date, outcome or reversal. Reactions, rewrites and re-reports of the same
  event are not new.
- Leave out items published before the last posted story unless an earlier run
  clearly missed something major.

THE BAR MOVES WITH THE FIELD:
- First size the field: how many distinct, fresh events that fit this doc did
  your searches find?
- Busy field: post only the few the reader would regret missing. More
  candidates means a higher bar, not more stories.
- Quiet field: a smaller story that squarely fits the doc may go in. The longer
  it has been since the last posted story, compared with the cadence, the more
  a small but real development counts. You may then look back to anything
  published since the last story.
- The bar never drops below "relevant, new and real". Never fill space with
  tangential, stale or generic items to avoid an empty brief.

NOTHING NEW:
- If nothing clears the bar, write one line under the heading and nothing else:
  \`No change since YYYY-MM-DD.\` with the date of the last posted story, or
  \`No news yet.\` if this topic has never posted.`;
