// Make mode: a topic whose runs have Scout write one piece itself (a bedtime
// story, a word of the day, a poem) instead of researching news. No web
// tools, so no search fee. The prompt and the check of what comes back are
// shared by the hosted API path (@scout/research) and the Scout team runner.
//
// A piece is one story under the topic's heading with no citation:
//   ## <topic>
//   - `<today>` — <title: the piece's one-line key>
//     > <the piece>
// Its title is the key the "already sent" memory keeps (interests.sent_keys,
// filled by the SQL when the run lands), so a piece never repeats.

import { parseBrief } from "./brief-document.ts";
import { DEFAULT_BRIEF_SETTINGS } from "./brief-settings.ts";
import type { TopicCoverage } from "./contract.ts";
import { extractTopicSection } from "./coverage.ts";
import {
  LENGTH_RULES,
  languageName,
  stripBriefPreamble,
  type ResearchInterest,
} from "./research-prompt.ts";

// The setup chat's side, added only while settings.make_on is on: a create
// may carry "mode": "make".
export const MAKE_PROMPT_OP =
  "    // A topic Scout writes itself (see the make rule):\n" +
  '    { "op": "create", "topic": "<topic>", "doc": "<full markdown>", "mode": "make" },';

export const MAKE_PROMPT_RULES = [
  "- Most topics are news: Scout searches the web for what is new. When the user",
  "    asks for a piece made fresh for them each time (a bedtime story, a poem, a",
  "    word or phrase of the day, a quiz) rather than news, create it with",
  '    "mode": "make": Scout writes it itself, with no searching. Its doc says what to',
  "    write: who it is for, the form, tone, length and language, and what to vary.",
  '    Its `reply` says plainly that Scout writes it, e.g. "Scout writes \\"Bedtime',
  '    story\\" for you each day." News about a subject ("children\'s book news",',
  '    "new poetry collections") stays news: omit `mode`.',
].join("\n");

// How many earlier pieces a make topic remembers (the SQL keeps as many).
export const MAX_SENT_KEYS = 60;

// A piece's key as compared: case, markdown emphasis, punctuation and spacing
// do not make a piece new.
export function pieceKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isoDay(now: Date): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

// The prompt for one make run: the intent doc verbatim, today's date, the
// language and length, and what was already sent.
export function buildMakePrompt(
  interest: ResearchInterest,
  now: Date = new Date(),
): string {
  const today = isoDay(now);
  const { topic, doc } = interest;
  const settings = interest.settings ?? DEFAULT_BRIEF_SETTINGS;
  const sent = (interest.sent ?? []).slice(-MAX_SENT_KEYS);
  const length = LENGTH_RULES[settings.length];
  const lines: string[] = [];
  lines.push(
    `You are Scout. For the topic "${topic}" you write one new piece yourself today: no web search, no fetching, no news. Write it from what you know and your own imagination.`,
    "",
    `What the reader wants from "${topic}" (their intent — follow it closely):`,
    "<intent-doc>",
    doc,
    "</intent-doc>",
    "",
    `Today's date is ${today}.`,
    settings.briefLanguage
      ? `Write the piece in ${languageName(settings.briefLanguage)}. The \`## ${topic}\` heading stays as written.`
      : "Write the piece in the intent doc's language.",
    "",
    "Rules:",
    "- Fit the intent doc: its reader, tone, form and limits. A piece that does not fit is worse than a short one.",
    "- Facts in the piece (a word's meaning, a date, a name) must be true. Invent only where the piece is fiction.",
    "- Never repeat an earlier piece: a new title, and a new subject or story, not the same one retold.",
  );
  if (sent.length > 0) {
    lines.push("", "Already sent (never repeat these):");
    for (const key of sent) lines.push(`- ${key}`);
  }
  lines.push(
    "",
    "Output requirements:",
    "- GitHub-flavored Markdown only. No preamble, no trailing commentary.",
    `- Output EXACTLY one \`## ${topic}\` section, the heading the topic VERBATIM.`,
    `- Under it, one line: - \`${today}\` — <title>  (the title names this piece in a few words).`,
    "- Under that line, the piece as an indented `> …` blockquote. Lines of verse end in a backslash so the line breaks hold.",
    "- No links, no citations, no images.",
    `- Keep the whole section under ~${length.words} words.`,
    "",
    "Write the piece now.",
  );
  return lines.join("\n");
}

// A story line written without its `- ` bullet.
const UNBULLETED_STORY_RE = /^(`(?:\d{4}-\d{2}-\d{2}|undated)`\s*[—–-])/gm;

/**
 * The topic's section from a make run's answer and its coverage (always
 * "covered": a piece has no citation, but it is the brief). An error when the
 * answer holds no piece, or repeats one already sent.
 */
export function makeSectionFromAnswer(
  answer: string,
  interest: ResearchInterest,
): { sectionMd: string; coverage: TopicCoverage } | { error: string } {
  const section = extractTopicSection(
    stripBriefPreamble(answer),
    interest.topic,
  );
  if (!section) return { error: "Claude returned no section" };
  const sectionMd = section.replace(UNBULLETED_STORY_RE, "- $1");
  const piece = parseBrief(sectionMd).entries.find((e) => e.kind === "story");
  if (!piece || piece.kind !== "story" || !piece.body)
    return { error: "Claude returned no piece" };
  const key = pieceKey(piece.summary);
  if (!key) return { error: "the piece has no title" };
  if ((interest.sent ?? []).some((s) => pieceKey(s) === key))
    return { error: `the piece was already sent: ${piece.summary}` };
  return { sectionMd, coverage: { topic: interest.topic, status: "covered" } };
}
