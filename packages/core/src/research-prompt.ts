// The research prompt for one interest, and the clean-up of what comes back.
// Pure: the caller runs the session (the companion's `claude` CLI today).

import { parseBrief } from "./brief-document.ts";
import { DEFAULT_BRIEF_SETTINGS, MAX_STORIES } from "./brief-settings.ts";
import type { BriefLength, BriefSettings } from "./contract.ts";
import { normalizeTopic } from "./coverage.ts";
import { RELEVANCE_SKILLS } from "./relevance-skills.ts";
import { SEARCH_SKILLS } from "./search-skills.ts";

// An earlier brief the reader saw: when it was made and its markdown (a whole
// brief or just this topic's section).
export type PriorBrief = { date: string; markdown: string };

// One interest to research in its own session. `topic` is the short headline
// (and the canonical `## <topic>` heading); `doc` is that interest's intent doc,
// injected VERBATIM. The caller backfills a default doc (ensureInterestDoc) so
// `doc` is always non-empty. `settings` shape the section (defaults when
// left out); `prior` lists the reader's earlier briefs, newest first.
// `cadence` is how often the topic runs and `lastPosted` the date (ISO) of
// the last brief that carried a story on it (null: never); both feed the
// relevance rules.
export type ResearchInterest = {
  topic: string;
  doc: string;
  settings?: BriefSettings;
  prior?: readonly PriorBrief[];
  cadence?: "daily" | "weekly" | null;
  lastPosted?: string | null;
  // "make": Scout writes one piece itself, no web tools (make-piece.ts), and
  // `sent` lists the keys of the pieces it already sent, oldest first.
  mode?: "news" | "make";
  sent?: readonly string[];
};

// The web tools a research session has, by the names its prompt uses: the
// companion's `claude` CLI has WebSearch/WebFetch, the hosted API path has the
// server tools web_search/web_fetch (packages/research).
export type ResearchTools = { search: string; fetch: string };
export const CLI_RESEARCH_TOOLS: ResearchTools = {
  search: "WebSearch",
  fetch: "WebFetch",
};
export const API_RESEARCH_TOOLS: ResearchTools = {
  search: "web_search",
  fetch: "web_fetch",
};

// Strip the `claude` CLI's conversational lead-in before the actual brief.
//
// Even with "No preamble" in the prompt, the headless `claude` run sometimes
// emits a meta sentence first — e.g. "I have enough to write the brief." —
// which then leaks into the rendered brief. The brief itself is
// required to start with the `# Your brief` H1, so the robust fix is: if any
// markdown heading exists, drop everything before the first one. Fallback for
// the (rare) headingless case: drop a single leading non-bullet paragraph.
export function stripBriefPreamble(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  // Primary path: slice from the first markdown heading line (`# `, `## `, …).
  const headingMatch = text.match(/^#{1,6}\s/m);
  if (
    headingMatch &&
    headingMatch.index !== undefined &&
    headingMatch.index > 0
  ) {
    return text.slice(headingMatch.index).trim();
  }
  if (headingMatch) return text; // already starts at the heading — nothing to strip.

  // Fallback: no heading at all. If the first paragraph is plain prose (not a
  // list item or citation) and more content follows, treat it as preamble.
  const paras = text.split(/\n\s*\n/);
  if (paras.length > 1 && !/^\s*[-*]\s|\]\(/.test(paras[0])) {
    return paras.slice(1).join("\n\n").trim();
  }
  return text;
}

// What the reader's last briefs already reported on this topic, newest brief
// first, so the next run reports only what is new or changed.
export type ReportedStory = { date: string | null; title: string; url: string };
export type ReportedBrief = { date: string; stories: ReportedStory[] };

// The stories of earlier briefs that sit under this topic's heading (a whole
// brief from the companion, or one hosted section). Keeps at most `limit`
// briefs; a brief with no story for the topic still counts, so "No change
// since <date>" names the last brief the reader saw.
export function reportedStories(
  prior: readonly PriorBrief[],
  topic: string,
  limit = 2,
): ReportedBrief[] {
  const key = normalizeTopic(topic);
  return prior.slice(0, limit).map((brief) => ({
    date: brief.date.slice(0, 10),
    stories: parseBrief(brief.markdown).entries.flatMap((e) =>
      e.kind === "story" &&
      e.links.length > 0 &&
      (e.topic === null || normalizeTopic(e.topic) === key)
        ? [{ date: e.date, title: e.links[0].label, url: e.links[0].url }]
        : [],
    ),
  }));
}

// A level-2..4 heading (or bold line) in the intent doc naming the sources to
// read before searching.
const SOURCES_FIRST_RE = /^\s*(?:#{1,6}\s*|\*\*)\s*sources,?\s+check\s+first/im;

// Body paragraphs and the section's word cap per length setting.
export const LENGTH_RULES: Record<
  BriefLength,
  { paragraphs: string; extra: string; words: number }
> = {
  short: { paragraphs: "1", extra: "no follow-on paragraphs", words: 350 },
  normal: {
    paragraphs: "1-3",
    extra: "at most 2 follow-on paragraphs",
    words: 700,
  },
  long: { paragraphs: "3-5", extra: "2-4 follow-on paragraphs", words: 1100 },
};

// "nb-NO" → "Norwegian Bokmål (Norway)"; the tag itself when the runtime has
// no names for it.
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// Build the prompt for ONE interest's research session. Composition
// order is fixed and load-bearing: shared search skills (HOW to research) →
// the interest's intent doc VERBATIM (WHAT to research) → today's date (the
// recency anchor) → this interest's settings and what it already reported.
// The skills are the canonical, version-controlled rules imported from
// search-skills.ts (never copied); the doc is this interest's captured intent.
// The doc MUST appear verbatim: if editing a doc doesn't change the next
// run's prompt, the control is dead. research-prompt.test.ts pins that.
export function buildResearchPrompt(
  interest: ResearchInterest,
  now: Date = new Date(),
  tools: ResearchTools = CLI_RESEARCH_TOOLS,
  limits: { maxSearches?: number } = {},
): string {
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-"); // Local YYYY-MM-DD, anchors "last 7 days".
  const { topic, doc } = interest;
  const settings = interest.settings ?? DEFAULT_BRIEF_SETTINGS;
  const reported = reportedStories(interest.prior ?? [], topic);
  // The last posted story's date: given by the caller, else the newest of the
  // earlier briefs that carried one; null when the topic never posted.
  const lastPosted =
    interest.lastPosted !== undefined
      ? (interest.lastPosted?.slice(0, 10) ?? null)
      : (reported.find((b) => b.stories.length > 0)?.date ?? null);
  const length = LENGTH_RULES[settings.length];
  const lines: string[] = [];
  lines.push(
    `You are Scout, an agent that researches and writes one section of a personalized news brief, for a single topic: "${topic}".`,
  );
  lines.push("");
  // 1. The shared "skills folder", injected into EVERY research session.
  lines.push(SEARCH_SKILLS);
  lines.push("");
  // 2. The interest's intent doc, VERBATIM, fenced so the model sees exactly
  //    where the reader's words begin and end.
  lines.push(
    `What the reader wants from "${topic}" (their intent — follow it closely):`,
  );
  lines.push("<intent-doc>");
  lines.push(doc);
  lines.push("</intent-doc>");
  lines.push("");
  // 3. The recency anchor.
  lines.push(
    `Today's date is ${today}. Use it to judge how recent each item is.`,
  );
  lines.push("");
  // 4. How to search.
  if (SOURCES_FIRST_RE.test(doc)) {
    lines.push(
      `The intent doc lists "Sources, check first". Use ${tools.fetch} on each of those`,
      `sources FIRST and report what is new there; then use ${tools.search} only for`,
      "what those sources missed.",
      `${tools.fetch} does not follow redirects and cuts long pages short: when a`,
      `fetch fails, redirects or is cut off, use ${tools.search} to find the specific`,
      "sub-page (the news or announcements page, the item itself) and fetch that.",
    );
  } else {
    lines.push(`Use the ${tools.search} tool to find news on this topic.`);
  }
  lines.push(
    `Use ${tools.fetch} on the most promising results to confirm the facts AND the`,
    "publish date, so you write a real summary (not a headline rehash) with a",
    "verified date.",
  );
  if (settings.searchLocale || settings.briefLanguage) {
    const where = settings.searchLocale
      ? `Search in ${languageName(settings.searchLocale)} and prefer sources from there`
      : "Search wherever the best sources are";
    const write = settings.briefLanguage
      ? `write the section in ${languageName(settings.briefLanguage)}`
      : "write the section in the intent doc's language";
    lines.push(
      `${where}; ${write}. The \`## ${topic}\` heading stays as written.`,
    );
  }
  // The API path caps searches in its tool definition; the CLI has no such
  // cap, so a capped CLI session is told its budget here.
  if (limits.maxSearches !== undefined) {
    lines.push(
      `Use ${tools.search} at most ${limits.maxSearches} times and ${tools.fetch} at most ${limits.maxSearches} times.`,
    );
  }
  lines.push("");
  // 5. Whether anything is worth posting: the shared relevance rules, then
  //    the facts they judge by (cadence, silence, what was already posted).
  //    No thresholds here: the rule text does the judging.
  lines.push(RELEVANCE_SKILLS);
  lines.push("");
  lines.push(`Cadence: ${interest.cadence ?? "on request"}.`);
  if (lastPosted) {
    const days = Math.max(
      0,
      Math.round((Date.parse(today) - Date.parse(lastPosted)) / 86_400_000),
    );
    lines.push(
      `Last posted story: ${lastPosted} (${days} day${days === 1 ? "" : "s"} ago).`,
    );
  } else {
    lines.push("Last posted story: never (this topic has not posted yet).");
  }
  if (reported.length > 0) {
    const posted = reported.filter((b) => b.stories.length > 0).length;
    lines.push(
      `${posted} of the last ${reported.length} briefs posted a story on this topic.`,
      "Stories already posted (newest brief first):",
    );
    for (const brief of reported) {
      lines.push(`- Brief of ${brief.date}:`);
      if (brief.stories.length === 0) lines.push("  - (no stories)");
      for (const s of brief.stories)
        lines.push(`  - \`${s.date ?? "undated"}\` ${s.title} — ${s.url}`);
    }
  }
  lines.push("");
  // 6. The output, shaped by this interest's settings.
  const max = settings.stories === "relevant" ? MAX_STORIES : settings.stories;
  lines.push("Output requirements:");
  lines.push(
    "- GitHub-flavored Markdown only. No preamble, no trailing commentary.",
    `- Output EXACTLY one \`## ${topic}\` section — the heading text must be the`,
    "  topic VERBATIM as written above (same words; capitalization may differ).",
    `- Under the heading, 0-${max} story bullets (never more than ${max}) that clear`,
    "  the relevance bar, newest first. Follow the date-first format in the search",
    "  skills above (ISO date in backticks leading each bullet, citation next line).",
    "- When the source page has a usable lead image, add the optional",
    "  `![source image](url)` line right under that story's citation, per the",
    "  SOURCE IMAGE rules above. Omit it when there isn't one — never invent it.",
    `- Under each story, add the IN-DEPTH BODY as an indented \`> …\` blockquote of`,
    `  ${length.paragraphs} paragraph(s): the short 1-2 sentence lead (the UI renders it in`,
    `  bold), then ${length.extra}, each adding a concrete, checkable`,
    "  detail grounded in the same sources.",
    "- A story's bullet summary and its body say only what that story's cited",
    "  sources say: no count, name or claim from another story or source. A count",
    '  in the summary ("two packages") is one the body bears out, naming each.',
  );
  if (settings.evergreen) {
    lines.push(
      "- This topic is marked evergreen: older background is welcome, so the",
      "  30-day limit does not apply. Still date every story.",
    );
  }
  lines.push(
    "- If the intent doc sets its own time window, use it in place of the",
    "  7- and 30-day windows above (never older than 30 days unless evergreen).",
    "- If nothing clears the bar, STILL emit the heading with exactly one line under it:",
    lastPosted
      ? `  \`No change since ${lastPosted}.\` (or the intent doc's own one-line "no change" text, if it gives one).`
      : "  `No news yet.`",
  );
  lines.push(`- Keep the whole section under ~${length.words} words.`);
  lines.push("");
  lines.push("Write the section now.");
  return lines.join("\n");
}
