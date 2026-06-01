// Per-topic coverage detection + section merge for the brief engine (PER-154).
//
// The whole brief is produced by ONE `claude` call that emits a single markdown
// document with `## <topic>` sections. The web app used to decide which topics
// "came back" by checking, case-sensitively, whether each requested interest
// string appeared verbatim as a parsed heading. That silently mis-fired the
// moment the model title-cased or rephrased a heading — "ai" → "## AI",
// "openai" → "## OpenAI", "claude code" → "## Claude Code" — flagging covered
// topics as empty, and a Retry just re-ran the same prompt and reproduced the
// same casing, so it never recovered (the founder's exact bug report).
//
// The companion now owns coverage detection authoritatively, with NORMALIZED
// matching (case / punctuation / whitespace insensitive), and distinguishes
// three honest states per topic:
//   - "covered": a matching section exists and carries real content (a citation).
//   - "empty":   a matching section exists but the model said `_no fresh news_`
//                (or produced no citation) — a genuine "nothing today", not a bug.
//   - "missing": no matching section at all — the model dropped/merged the topic.
//                This is the only state that warrants an automatic retry.
//
// All functions here are PURE so they can be unit-tested without spawning claude.

export type TopicStatus = "covered" | "empty" | "missing";
export type TopicCoverage = { topic: string; status: TopicStatus };

// Normalize a topic or heading for comparison: lowercase, strip everything that
// isn't a letter/digit down to single spaces, trim. So "OpenAI", "open ai",
// "Open-AI" and "openai" all collapse to the same key, and "Claude Code" matches
// "claude code". Intentionally aggressive — headings drift in casing and
// punctuation far more than in actual wording.
export function normalizeTopic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type SectionBlock = { key: string; raw: string };

// Split a brief into the preamble (everything before the first `## ` heading,
// e.g. the `# Your brief` title) and an ordered list of `## ` section blocks.
// Each block's `raw` includes its own heading line and body verbatim, so blocks
// can be recombined losslessly. `key` is the normalized heading for matching.
function sectionBlocks(markdown: string): { pre: string; blocks: SectionBlock[] } {
  // Lookahead split keeps the `## ` delimiter at the start of each chunk.
  const parts = markdown.split(/(?=^##\s)/m);
  let pre = "";
  let start = 0;
  if (parts.length > 0 && !/^##\s/.test(parts[0])) {
    pre = parts[0];
    start = 1;
  }
  const blocks: SectionBlock[] = [];
  for (let i = start; i < parts.length; i++) {
    const raw = parts[i];
    const h = /^##\s+(.+?)\s*$/m.exec(raw);
    blocks.push({ key: h ? normalizeTopic(h[1]) : "", raw });
  }
  return { pre, blocks };
}

// Classify every requested interest against the brief markdown. Order follows
// the requested-interest order, not the document order.
export function computeCoverage(
  interests: string[],
  markdown: string,
): TopicCoverage[] {
  const { blocks } = sectionBlocks(markdown);
  // First matching block per key wins (a model rarely repeats a heading).
  const byKey = new Map<string, string>();
  for (const b of blocks) {
    if (b.key && !byKey.has(b.key)) byKey.set(b.key, b.raw);
  }
  return interests.map((topic) => {
    const raw = byKey.get(normalizeTopic(topic));
    if (raw === undefined) return { topic, status: "missing" as const };
    // Strip the heading line; judge the body.
    const body = raw.replace(/^##\s+.+$/m, "").trim();
    const hasCitation = /\]\(https?:\/\//.test(body);
    const noNews = /_+\s*no fresh news\s*_+/i.test(body);
    if (noNews || !hasCitation) return { topic, status: "empty" as const };
    return { topic, status: "covered" as const };
  });
}

// Merge freshly-researched sections for `retriedTopics` into a prior brief,
// replacing those topics' sections in place (and appending any that were
// missing before). Sections the retry didn't touch are preserved exactly. The
// preamble (`# Your brief`) comes from the base. Used by the focused-retry path
// so a retry recovers only the failed topics without re-spending budget on the
// ones that already worked or clobbering them.
export function mergeBriefSections(
  baseMarkdown: string,
  patchMarkdown: string,
  retriedTopics: string[],
): string {
  const retryKeys = new Set(retriedTopics.map(normalizeTopic));
  const base = sectionBlocks(baseMarkdown);
  const patch = sectionBlocks(patchMarkdown);

  const patchByKey = new Map<string, string>();
  for (const b of patch.blocks) {
    if (retryKeys.has(b.key) && !patchByKey.has(b.key)) patchByKey.set(b.key, b.raw);
  }

  const used = new Set<string>();
  const merged = base.blocks.map((b) => {
    if (retryKeys.has(b.key) && patchByKey.has(b.key)) {
      used.add(b.key);
      return patchByKey.get(b.key)!;
    }
    return b.raw;
  });

  // Topics that were missing from the base entirely → append their new sections.
  for (const [key, raw] of patchByKey) {
    if (!used.has(key)) merged.push(raw);
  }

  // Guarantee a newline boundary between concatenated blocks. A prior brief's
  // markdown has usually been trimmed (stripBriefPreamble), so its LAST section
  // lost its trailing newline — concatenating an appended section directly onto
  // it would glue `…](url)## Next` onto one line and break the `^## ` heading
  // detection on the very topic we just recovered. Normalizing each block to end
  // in a single newline keeps every heading line-anchored.
  const pre = base.pre && !base.pre.endsWith("\n") ? base.pre + "\n" : base.pre;
  const body = merged.map((s) => (s.endsWith("\n") ? s : s + "\n")).join("");
  return pre + body;
}
