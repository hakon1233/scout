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
//
// The optional SOURCE IMAGE line (`![source image](URL)`) is ALSO part of that
// contract (PER-211): the parser reads it into Article.imageUrl to render the
// news-feed card's main image. It must sit on its own line under the citation so
// it stays a markdown image (the parser skips `!`-prefixed links so an image
// URL is never mistaken for a citation).
//
// The optional IN-DEPTH BODY (an indented `> …` blockquote under the citation/
// image) is the third part of that contract (PER-214): the parser reads those
// blockquote lines into Article.body — the few concise paragraphs the detail
// view renders on click. Its first paragraph is the bold lead summary; later
// paragraphs carry deeper insight. It must be plain prose (no links/images) so
// it never collides with the citation or source-image parse, and the feed
// bullet's one-sentence summary stays the SHORT card blurb.
//
// PER-265: the founder found detail-view bodies shallow across EVERY topic, not
// just broad ones — so the fix is a straight quality/length bump to this one
// rule (3-5 substantive paragraphs, each required to add a concrete detail),
// not a topic-breadth branch. Applies uniformly; there is deliberately no
// "general vs specific topic" distinction anywhere in these rules.

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

SOURCE IMAGE (one per item, OPTIONAL, handpicked from the source — never invented):
- For each story, try to capture ONE representative image taken FROM THE NEWS
  SOURCE PAGE ITSELF — the article's own lead image. WebFetch the cited page and
  read, in order of preference: \`<meta property="og:image">\`, then
  \`<meta name="twitter:image">\`, then the first meaningful inline \`<img>\` in the
  article body. Use the absolute (https) image URL.
- Put it on its OWN line immediately AFTER the citation line, as a markdown image:
  - \`YYYY-MM-DD\` — one-sentence summary of what happened.
    [domain — Title](url)
    ![source image](https://image-url-from-the-source)
- NEVER invent, generate, screenshot, or substitute a stock/placeholder image. If
  the source has no usable lead image, or it's paywalled / blocked / a tiny
  logo-icon / a tracking pixel, simply OMIT the image line — a text-only item is
  correct and expected. Do not output a broken or guessed URL.
- One image per story maximum. Prefer a wide/landscape editorial lead image; skip
  sprites, avatars, share-button icons, and sub-200px thumbnails.

IN-DEPTH BODY (one per item, render contract for the click-through detail — PER-214/PER-256/PER-265):
- The one-sentence summary on the bullet line is the SHORT feed blurb. In ADDITION,
  give each story a multi-paragraph detail body that the reader sees only after
  clicking into that story.
- The FIRST paragraph must be a short lead summary: 1-2 sentences that quickly
  state what happened and why the reader should care. The UI renders this first
  paragraph in bold, so write it as the crisp lead, not as background.
- Follow-on paragraphs must be deeper insight/analysis: concrete specifics,
  implications, context, what changed, what remains uncertain, and why it matters
  for this interest. Aim for 3-5 additional paragraphs — this applies to EVERY
  topic equally, general/broad or narrow. EACH follow-on paragraph must earn its
  place with at least one concrete, checkable detail not already in the lead — a
  number, a name, a quote, a mechanism, a specific consequence — never a
  paragraph that just restates the lead in different words or pads with generic
  framing. Concise but genuinely informative — not a wall of text, but also not
  thin. If a story honestly has little to say, a shorter body (or none) is fine —
  NEVER pad, invent, or speculate to hit a length. Stay grounded in the SAME
  sources you already read; add no new claims you can't back from them.
- Emit it as an INDENTED markdown blockquote on the lines AFTER the citation (and
  the optional source-image line), each paragraph a \`> \` line, paragraphs
  separated by a bare \`>\` line:
  - \`YYYY-MM-DD\` — one-sentence summary of what happened.
    [domain — Title](url)
    ![source image](https://image-url-from-the-source)
    > First paragraph: 1-2 sentence lead summary.
    >
    > Second paragraph: deeper insight, implications, and key specifics.
    >
    > Third paragraph: another concrete detail — a number, a name, a quote.
    >
    > Fourth paragraph: useful context, tradeoffs, or what to watch next.
- The blockquote is the ONLY place depth goes — keep the bullet's summary to one
  sentence so the feed card stays short. Do not put links or images inside the
  blockquote; keep it plain prose.

SOURCES & QUALITY:
- Prefer primary / original sources — the company's own announcement, the filing,
  the paper, the official post — over second-hand aggregation or rewrites.
- Deduplicate: collapse near-identical stories about the same event into a single
  item and cite the strongest source.
- No speculation, no undated filler, no "here's some general background" padding.`;
