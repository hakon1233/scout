// The shared "skills folder" — the single, canonical set of rules for HOW
// Scout searches for news. It is injected verbatim into EVERY research session:
// today's single multi-topic session (research.ts) and, later, C2's per-interest
// sessions. The per-interest doc says WHAT to look for; this fragment says HOW.
// They compose — never copy-paste this text anywhere, import SEARCH_SKILLS.
//
// Origin: PER-176 (founder pain — runs surfaced months-old stories with no
// dates). These rules make recency a hard constraint and make every item carry
// a parseable publish date so the UI can render and sort by it.
//
// The date convention below is a CONTRACT with the renderer: each story bullet
// begins with its publish date as an ISO date in backticks (or `undated`). The
// web app (src/lib/companion.ts `parseArticlesFromMarkdown`) parses that token
// into Article.publishedAt and renders it per item. If you change the on-the-
// wire format here, update that parser and BriefView together.

export const STORY_DATE_RE = /`(\d{4}-\d{2}-\d{2}|undated)`/;

export const SEARCH_SKILLS = `## Search skills — mandatory rules for every topic

These rules govern HOW you research and are NON-NEGOTIABLE. They apply to every
topic equally. The topics below tell you WHAT to look for; these rules tell you
how to find it and how fresh it must be.

RECENCY (the whole point of this brief):
- Strongly prefer items published in the LAST 7 DAYS. A fresh, smaller story
  beats a stale, bigger one — the reader wants to know what is happening NOW.
- If a topic has nothing worth reporting from the last 7 days, widen the window
  to the LAST 30 DAYS and say so explicitly: make the FIRST line under that
  topic's heading exactly \`_Nothing notable in the last week — showing older items._\`
  (on its own line), then list the older items below it.
- NEVER silently present months-old articles as if they were current news.
- Do NOT include anything published more than ~30 days ago unless the topic
  explicitly asks for background / evergreen / historical context.

PUBLISH DATES (one per item, mandatory, captured as a field — not buried in link text):
- Every story item MUST carry its real publish date. Verify it from the source;
  if the search snippet doesn't show a date, WebFetch the page to confirm it.
  Use the article's own publish/updated date — never substitute today's date.
- Format every story bullet so the publish date comes FIRST as an ISO date in
  backticks, then an em dash, then a one-sentence summary, then the citation on
  the next line:
  - \`YYYY-MM-DD\` — one-sentence summary of what happened.
    [domain — Title](url)
- Within each topic's section, sort the items NEWEST FIRST (most recent date at
  the top).
- If a date genuinely cannot be determined, write \`undated\` in place of the date,
  place that item LAST in its section, and prefer not to include it at all if a
  dated alternative exists. Never drop the date marker entirely.

SOURCES & QUALITY:
- Prefer primary / original sources — the company's own announcement, the filing,
  the paper, the official post — over second-hand aggregation or rewrites.
- Deduplicate: collapse near-identical stories about the same event into a single
  item and cite the strongest source.
- No speculation, no undated filler, no "here's some general background" padding.`;
