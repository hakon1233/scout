// The human-readable description of HOW Scout assembles researched findings into
// the brief you read. This is the assembly counterpart to search-skills.ts:
// SEARCH_SKILLS says how Scout RESEARCHES; ASSEMBLY_SKILLS says how Scout turns
// that research into one ordered, dated brief.
//
// Unlike SEARCH_SKILLS, this string is NOT injected into the model — the
// assembly behaviors it describes are enforced deterministically IN CODE
// (coverage.ts: extractTopicSection, sortSectionStoriesNewestFirst,
// assembleBrief, computeCoverage, mergeBriefSections; runner.ts: the
// per-interest session loop). This constant is the single canonical place those
// behaviors are explained for a reader, and it is rendered verbatim on the
// in-development `/app/skills` transparency page. Keep it HONEST: when you change
// the assembly engine, update the matching item here so the page never overstates
// or misstates what the engine really does. Same on-the-wire shape as
// SEARCH_SKILLS (ALL-CAPS group label ending in `:`, then `- ` bullets) so the
// web app parses both with one parser.

export const ASSEMBLY_SKILLS = `## Article-assembly skills — how Scout builds your brief

After researching each interest, Scout assembles the findings into one brief.
These rules are enforced in the engine (not left to the model), so your brief
reads the same way every time, no matter which topics ran.

ONE SECTION PER INTEREST:
- Each interest you follow is researched in its own session and rendered as its
  own section, in the order you listed your interests.
- Scout re-labels every section with your exact interest wording, so a model that
  title-cases or rephrases a heading can't fragment or mislabel your topics.
- An interest whose research came back empty-handed is omitted rather than faked
  with a blank section — the brief only shows topics it actually found news for.

NEWEST FIRST, ALWAYS:
- Within every section, stories are sorted strictly newest-first by their verified
  publish date — enforced deterministically after research, not trusted to the model.
- Stories sharing the same date keep their original order; a story with no
  determinable date sinks to the bottom of its section.

HONEST COVERAGE (covered / nothing-new / didn't-come-back):
- Every interest you asked for is classified as one of three states: it has real
  cited stories, it was checked but had nothing fresh today, or it didn't come back.
- "Nothing fresh today" is treated as an honest result, not an error — Scout tells
  you it checked and there was nothing new, instead of hiding the topic or padding
  it with filler.
- Only a topic that genuinely didn't come back prompts a retry, and that retry
  re-researches just that one topic and splices it back in — the sections that
  already worked are preserved exactly, not regenerated.

FRESHNESS ENFORCED, NOT JUST REQUESTED:
- Ordinary news older than ~30 days is dropped from your brief in code before it's
  saved — not merely discouraged in the research instructions — so a months-old
  story can't slip through even if a research session surfaces one.
- Interests that explicitly ask for background, evergreen, historical, or
  explainer-style context are exempt: there Scout keeps the older material you
  asked for on purpose.
- If enforcing freshness empties a topic, it's shown honestly as "nothing fresh"
  rather than padded with stale items.

DATED AND SOURCED:
- Every story carries its real publish date, a one-sentence summary of what
  happened, and a link to the strongest source — primary sources are preferred
  over second-hand rewrites.
- When the source page has a usable lead image, Scout handpicks that image to head
  the story — it never invents, generates, or substitutes a stock placeholder.`;
