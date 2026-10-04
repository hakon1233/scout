// Single-shot research + synthesis via the local `claude` CLI.
//
// Instead of calling a third-party search API and then asking a model to
// summarize, we hand the whole pipeline to a headless `claude` child that may
// use only WebSearch and WebFetch (see claude-runner.ts). The model picks
// queries, reads pages, and writes the brief section directly.

import type { spawn } from "node:child_process";
import { runClaude } from "./claude-runner.js";
import { SEARCH_SKILLS } from "./search-skills.js";

export type ResearchOptions = {
  claudeBin?: string;
  // Test seam: a stub `claude` without the real binary or network.
  spawnFn?: typeof spawn;
  // Per-session hard timeout in ms; defaults to SCOUT_SESSION_TIMEOUT_MS or 4 min.
  timeoutMs?: number;
};

// One interest to research in its own session. `topic` is the short headline
// (and the canonical `## <topic>` heading); `doc` is that interest's intent doc,
// injected VERBATIM. The caller backfills a default doc (ensureInterestDoc) so
// `doc` is always non-empty.
export type ResearchInterest = {
  topic: string;
  doc: string;
};

// Research a SINGLE interest in its own headless `claude` session with only
// WebSearch and WebFetch. Each interest gets its own session so the doc that
// scopes WHAT to look for reaches the model. Returns the session's
// preamble-stripped markdown; the runner extracts the topic's section and
// assembles the full brief across interests.
export async function researchAndSynthesize(
  interest: ResearchInterest,
  opts: ResearchOptions = {},
): Promise<string> {
  const raw = await runClaude(buildResearchPrompt(interest), {
    tools: "web-research",
    label: `claude session for "${interest.topic}"`,
    claudeBin: opts.claudeBin,
    spawnFn: opts.spawnFn,
    timeoutMs: opts.timeoutMs,
  });
  const text = stripBriefPreamble(raw);
  if (!text) throw new Error("claude returned empty output");
  return text;
}

// Strip the `claude` CLI's conversational lead-in before the actual brief.
//
// Even with "No preamble" in the prompt, the headless `claude` run sometimes
// emits a meta sentence first — e.g. "I have enough to write the brief." —
// which then leaks into the rendered brief (PER-113 #1). The brief itself is
// required to start with the `# Your brief` H1, so the robust fix is: if any
// markdown heading exists, drop everything before the first one. Fallback for
// the (rare) headingless case: drop a single leading non-bullet paragraph.
export function stripBriefPreamble(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  // Primary path: slice from the first markdown heading line (`# `, `## `, …).
  const headingMatch = text.match(/^#{1,6}\s/m);
  if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
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

// Build the prompt for ONE interest's research session (C2/PER-171). Composition
// order is fixed and load-bearing: shared search skills (HOW to research) →
// the interest's intent doc VERBATIM (WHAT to research) → today's date (the
// recency anchor). The two layers compose — the skills are the canonical,
// version-controlled rules imported from search-skills.ts (never copied), the
// doc is this interest's captured intent. The doc MUST appear verbatim: if
// editing a doc doesn't change the next run's prompt, the control is dead
// (PER-139). research.test.ts pins that invariant.
export function buildResearchPrompt(
  interest: ResearchInterest,
  now: Date = new Date(),
): string {
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-"); // Local YYYY-MM-DD, anchors "last 7 days".
  const { topic, doc } = interest;
  const lines: string[] = [];
  lines.push(
    `You are Scout, an agent that researches and writes one section of a personalized news brief, for a single topic: "${topic}".`,
  );
  lines.push("");
  // 1. The shared "skills folder" — one canonical, version-controlled fragment
  //    (search-skills.ts) injected into EVERY research session. Defines recency,
  //    mandatory per-story dates, source quality, and the date-first bullet format.
  lines.push(SEARCH_SKILLS);
  lines.push("");
  // 2. The interest's intent doc, VERBATIM. It says WHAT the reader wants from
  //    this topic; the skills above say HOW to find it. Fenced so the model sees
  //    exactly where the reader's words begin and end.
  lines.push(`What the reader wants from "${topic}" (their intent — follow it closely):`);
  lines.push("<intent-doc>");
  lines.push(doc);
  lines.push("</intent-doc>");
  lines.push("");
  // 3. The recency anchor.
  lines.push(`Today's date is ${today}. Use it to judge how recent each item is.`);
  lines.push("");
  lines.push("Use the WebSearch tool to find news on this topic. Use WebFetch on the");
  lines.push("most promising results to confirm the facts AND the publish date, so you");
  lines.push("write a real summary (not a headline rehash) with a verified date.");
  lines.push("");
  lines.push("Output requirements:");
  lines.push("- GitHub-flavored Markdown only. No preamble, no trailing commentary.");
  lines.push(`- Output EXACTLY one \`## ${topic}\` section — the heading text must be the`);
  lines.push("  topic VERBATIM as written above (same words; capitalization may differ).");
  lines.push("- Under the heading, 2-4 story bullets following the date-first format and");
  lines.push("  recency rules in the search skills above (newest first, ISO date in");
  lines.push("  backticks leading each bullet, citation on the next line).");
  lines.push("- When the source page has a usable lead image, add the optional");
  lines.push("  `![source image](url)` line right under that story's citation, per the");
  lines.push("  SOURCE IMAGE rules above. Omit it when there isn't one — never invent it.");
  lines.push("- Under each story, add the IN-DEPTH BODY as an indented `> …` blockquote");
  lines.push("  per the rules above. The FIRST paragraph must be a short 1-2 sentence");
  lines.push("  lead summary; the UI renders it in bold. Follow it with 3-5 more");
  lines.push("  paragraphs of deeper insight/analysis — EACH must add a concrete,");
  lines.push("  checkable detail (a number, a name, a quote, a mechanism, a specific");
  lines.push("  consequence) grounded in the same sources, not a restatement of the");
  lines.push("  lead. This is what the reader sees only on click; keep the bullet");
  lines.push("  summary itself to one sentence. This depth bar is the SAME for every");
  lines.push("  topic — broad/general topics get no less depth than narrow ones.");
  lines.push("- If you genuinely can't find anything within the last 30 days, STILL emit");
  lines.push(`  the \`## ${topic}\` heading with a single line \`_no fresh news_\` underneath.`);
  lines.push("- Keep each story's one-line summary tight; the in-depth blockquote body may");
  lines.push("  run a short bold lead plus 3-5 substantive follow-on paragraphs. Keep the");
  lines.push("  whole section under ~950 words.");
  lines.push("");
  lines.push("Write the section now.");
  return lines.join("\n");
}
