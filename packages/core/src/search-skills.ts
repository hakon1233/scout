// The shared "skills folder" — the single, canonical set of rules for HOW
// Scout searches for news. It is injected verbatim into EVERY per-interest
// research session (research.ts). The per-interest doc says WHAT to look for;
// this fragment says HOW. They compose — never copy-paste this text anywhere,
// import SEARCH_SKILLS.
//
// Origin: runs surfaced months-old stories with no dates. These rules make
// recency a hard constraint and make every item carry a parseable publish date
// so the UI can render and sort by it.
//
// The date convention below is a CONTRACT with the renderer: each story bullet
// begins with its publish date as an ISO date in backticks (or `undated`). The
// web app (src/lib/companion.ts `parseArticlesFromMarkdown`) parses that token
// into Article.publishedAt and renders it per item. If you change the on-the-
// wire format here, update that parser and BriefView together.
//
// The optional SOURCE IMAGE line (`![source image](URL)`) is ALSO part of that
// contract: the parser reads it into Article.imageUrl to render the
// news-feed card's main image. It must sit on its own line under the citation so
// it stays a markdown image (the parser skips `!`-prefixed links so an image
// URL is never mistaken for a citation).
//
// The optional IN-DEPTH BODY (an indented `> …` blockquote under the citation/
// image) is the third part of that contract: the parser reads those
// blockquote lines into Article.body — the few concise paragraphs the detail
// view renders on click. Its first paragraph is the bold lead summary; later
// paragraphs carry deeper insight. It may hold lists, tables and emphasis but
// never links or images, so it never collides with the citation or
// source-image parse, and the feed bullet's one-sentence summary stays the
// SHORT card blurb.
//
// Bodies are 1-3 paragraphs by default, each required to add a concrete
// detail; an interest's brief settings (brief-settings.ts) may ask for
// shorter or longer ones in the output requirements.

export const STORY_DATE_RE = /`(\d{4}-\d{2}-\d{2}|undated)`/;

export const SEARCH_SKILLS = `## Search skills — mandatory rules for every topic

These rules govern HOW you research and are NON-NEGOTIABLE. They apply to every
topic equally. The topics below tell you WHAT to look for; these rules tell you
how to find it and how fresh it must be.

RECENCY (the whole point of this brief):
- Strongly prefer items published in the LAST 7 DAYS. A fresh, smaller story
  beats a stale, bigger one — the reader wants to know what is happening NOW.
- A quiet topic may look back further only as the relevance bar below allows
  (to anything published since its last posted story). Never pad a quiet topic
  with older items to fill space.
- NEVER silently present months-old articles as if they were current news.
- Do NOT include anything published more than ~30 days ago unless the output
  requirements below mark this topic as evergreen.

PUBLISH DATES (one per item, mandatory, captured as a field — not buried in link text):
- Each story is ONE specific dated item: an article, post, release or
  announcement page. A homepage, front page, section, listing, event calendar
  or index page is not a story; leave it out (it may only point you to the
  specific item). Never give such a page today's date.
- The page for ONE specific event or announcement (a conference, a hearing, a
  consultation, a launch) IS a story. Date it by its publish date, and state
  the event's own date in the summary ("takes place 2026-12-03").
- Every story item MUST carry its real publish date. Verify it from the source;
  if the search snippet doesn't show a date, fetch the page to confirm it.
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
  SOURCE PAGE ITSELF — the article's own lead image. Fetch the cited page and
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

IN-DEPTH BODY (one per item, shown when the reader opens the story):
- The one-sentence summary on the bullet line is the SHORT feed blurb. In ADDITION,
  give each story a multi-paragraph detail body that the reader sees only after
  clicking into that story.
- The FIRST paragraph must be a short lead summary: 1-2 sentences that quickly
  state what happened and why the reader should care. The UI renders this first
  paragraph in bold, so write it as the crisp lead, not as background.
- Follow-on paragraphs must be deeper insight/analysis: concrete specifics,
  implications, context, what changed, what remains uncertain, and why it matters
  for this interest. Keep the whole body SHORT: 1-3 paragraphs in all unless the
  output requirements below set another length. EACH follow-on paragraph must earn its
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
- The blockquote is the ONLY place depth goes — keep the bullet's summary to one
  sentence so the feed card stays short. Inside it you may use a short list, a
  small table, **bold**, or \`code\` when that reads better than prose. Never put
  links or images inside the blockquote.

VOICE AND HEADLINES:
- Write as a news service, in the third person. Never write "I", "we", "my" or
  "our", and never report on your own research ("I could not verify…", "I did
  not find…"). When a detail is unconfirmed, say so plainly about the detail:
  "The release date is not confirmed."
- The bullet's summary says what happened in your own words. Do not repeat the
  source's title in it, and never put the citation link on the bullet line: the
  citation goes on its own line below.
- The citation's Title is the item's own headline and says what happened
  ("Oslo opens 40 new kindergarten places"). Never a section, listing or site
  name ("Events", "Arrangementer", "News", "Home"); when the page's own title
  is that generic, write a short, specific headline from its content.

RULES, LAWS AND REGULATIONS:
- When the intent doc asks for a rule's status or effective date, each story
  about a rule states its status — proposed, laid (before parliament) or in
  force — and its effective date when one is known ("in force from
  2027-01-01"). Write "effective date not yet set" rather than guess.

SOURCES & QUALITY:
- Prefer primary / original sources — the company's own announcement, the filing,
  the paper, the official post — over second-hand aggregation or rewrites.
- Deduplicate: collapse near-identical stories about the same event into a single
  item and cite the strongest source.
- No speculation, no undated filler, no "here's some general background" padding.
- When a topic spans several unrelated subjects, cover the most important ones and
  say which parts were skipped this time in one short line right under the
  heading ("Skipped this time: Oslo housing."). Never drop one silently.`;
