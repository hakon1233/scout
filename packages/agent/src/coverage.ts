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
//
// The user-facing, plain-language description of these assembly behaviors lives
// in assembly-skills.ts (ASSEMBLY_SKILLS) and is rendered on the in-development
// `/app/skills` transparency page. When you change the assembly logic below,
// update that constant too so the page stays honest about what the engine does.

export type TopicStatus = "covered" | "empty" | "missing";
export type TopicCoverage = { topic: string; status: TopicStatus };

// Normalize a topic or heading for comparison: lowercase, then remove every
// non-letter/digit. So "OpenAI", "open ai", "Open-AI" and "openai" all
// collapse to the same key. This is deliberately aggressive: model headings
// drift in casing, punctuation, and word spacing more often than in meaning.
export function normalizeTopic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
    const hasCitation = body
      .split("\n")
      .some(
        (line) =>
          !line.trimStart().startsWith("!") && /\]\(https?:\/\//.test(line),
      );
    const noNews = /_+\s*no fresh news\s*_+/i.test(body);
    if (noNews || !hasCitation) return { topic, status: "empty" as const };
    return { topic, status: "covered" as const };
  });
}

// Extract ONE topic's section from a single per-interest research session's
// output and re-emit it under the CANONICAL `## <topic>` heading (C2/PER-171).
//
// Per-interest sessions each research one topic and are asked for exactly one
// `## <topic>` section, but a headless `claude` run is free to title-case the
// heading, wrap it in a `# Your brief`, or (a generic test stub) emit a heading
// that doesn't match the requested topic at all. We don't trust the model's
// heading: we take the FIRST section's body and re-label it with the topic we
// actually asked for, so the assembled brief is coherent and coverage matching
// is exact. Returns null when the session produced no usable section body — the
// assembler then omits the topic entirely, which computeCoverage reports as
// "missing" (and PER-154's focused retry can recover).
export function extractTopicSection(
  sessionMarkdown: string,
  topic: string,
): string | null {
  const { pre, blocks } = sectionBlocks(sessionMarkdown);
  // Prefer the first `## ` block's body; fall back to the preamble text when the
  // session emitted bare prose with no heading at all.
  let body: string;
  if (blocks.length > 0) {
    body = blocks[0].raw.replace(/^##\s+.+$/m, "").trim();
  } else {
    body = pre.trim();
  }
  if (!body) return null;
  // C7 (PER-186): the model is *asked* to emit stories newest-first but only
  // does so intermittently. Enforce the order deterministically at the single
  // per-topic emit point so every assembled section is strictly newest-first.
  return `## ${topic}\n${sortSectionStoriesNewestFirst(body)}\n`;
}

// A story bullet leads with its publish date as an ISO date (or `undated`) in
// backticks — the date-first contract from search-skills.ts. The bullet may be
// `-` or `*` and indented; continuation lines (citation, wrapped summary) follow
// until the next bullet.
const STORY_BULLET_RE = /^\s*[-*]\s+`(\d{4}-\d{2}-\d{2}|undated)`/;

// Sort one section body's story bullets strictly newest-first by their leading
// ISO date (C7/PER-186). Each story — its bullet line plus any continuation
// lines up to the next bullet — moves as one block, so the citation stays with
// its story. Lines BEFORE the first story bullet (an intro line, the
// `_Nothing notable…_` / `_no fresh news_` note) are preserved verbatim at the
// top. `undated` stories sink to the bottom; stories with equal dates keep their
// original relative order (stable). Returns the body byte-identical when there's
// nothing to reorder, so an already-ordered section is untouched.
export function sortSectionStoriesNewestFirst(body: string): string {
  const lines = body.split("\n");
  const head: string[] = [];
  type Block = { date: string | null; lines: string[]; order: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const line of lines) {
    const m = STORY_BULLET_RE.exec(line);
    if (m) {
      cur = {
        date: m[1] === "undated" ? null : m[1],
        lines: [line],
        order: blocks.length,
      };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      head.push(line);
    }
  }
  if (blocks.length < 2) return body; // nothing to reorder
  const sorted = [...blocks].sort((a, b) => {
    if (a.date === b.date) return a.order - b.order; // stable tiebreak
    if (a.date === null) return 1; // undated sinks
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : -1; // ISO dates: lexical == chronological, desc
  });
  // Already in order ⇒ leave the body byte-identical.
  if (sorted.every((b, i) => b.order === i)) return body;
  return [...head, ...sorted.flatMap((b) => b.lines)].join("\n");
}

// ─── Freshness validator (PER-250) ──────────────────────────────────────────
//
// SEARCH_SKILLS forbids the model from emitting ordinary news older than ~30
// days, but that rule is PROMPT-enforced only: if the model includes a stale
// article anyway, assembly used to accept it as long as it had the right story
// shape. PER-247 confirmed this is the genuine freshness defect the founder hit
// (briefs surfacing months-old stories). This validator CODE-enforces the cutoff
// deterministically over the assembled brief, just before it is saved, so
// months-old ordinary news can no longer slip through.

// Ordinary news older than this many days is dropped. "~30 days" in the search
// rules; we treat strictly-older-than-30-days as stale.
export const FRESHNESS_CUTOFF_DAYS = 30;

// Words in an interest's topic or its intent doc that explicitly opt the topic
// into background / evergreen / historical content. Such a topic is EXEMPT from
// the freshness cutoff — the reader asked for older material on purpose.
const EVERGREEN_RE =
  /\b(evergreen|background|historical|history|retrospective|timeline|explainer|primer|deep[ -]dive|long[ -]read)\b/i;

// Does this interest explicitly ask for background / evergreen / historical
// context? Checked against BOTH the topic wording and its intent doc (PER-250).
export function interestWantsEvergreen(topic: string, doc: string): boolean {
  return EVERGREEN_RE.test(topic) || EVERGREEN_RE.test(doc);
}

// Drop ordinary stories older than `cutoffDays` from ONE section block's raw
// markdown (its `## heading` line plus body). Undated stories are kept as-is
// (we never had a date to judge them by — PER-250 keeps undated handling
// unchanged). Stories with an unparseable date marker are also kept rather than
// silently lost. When EVERY story in the section is dropped, the section body is
// replaced with the `_no fresh news_` marker so computeCoverage reports the
// topic as an honest "empty" (nothing fresh) state instead of leaving a dangling
// intro line — and any "showing older items" note, now false, is removed with
// it. Returns the block byte-identical when nothing is dropped.
function filterStaleStoriesFromBlock(
  raw: string,
  nowMs: number,
  cutoffDays: number,
): string {
  const endsNl = raw.endsWith("\n");
  const lines = raw.split("\n");
  const head: string[] = [];
  type Story = { date: string | null; lines: string[] };
  const stories: Story[] = [];
  let cur: Story | null = null;
  for (const line of lines) {
    const m = STORY_BULLET_RE.exec(line);
    if (m) {
      cur = { date: m[1] === "undated" ? null : m[1], lines: [line] };
      stories.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      head.push(line);
    }
  }
  if (stories.length === 0) return raw; // no dated bullets to validate
  const cutoffDate = new Date(nowMs - cutoffDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const kept = stories.filter((s) => {
    if (s.date === null) return true; // undated kept as-is
    return s.date >= cutoffDate; // YYYY-MM-DD: lexical == chronological, inclusive
  });
  if (kept.length === stories.length) return raw; // nothing stale ⇒ byte-identical

  // The heading line (`## topic`) is the first head line; preserve it exactly.
  const headingLine = head.find((l) => /^##\s/.test(l)) ?? head[0] ?? "";
  let out: string;
  if (kept.length === 0) {
    // Every item was stale — record an honest no-news section, dropping any now-
    // false intro/"older items" note along with the stale bullets.
    out = `${headingLine}\n_no fresh news_\n`;
  } else {
    out = [...head, ...kept.flatMap((s) => s.lines)].join("\n");
  }
  if (endsNl && !out.endsWith("\n")) out += "\n";
  return out;
}

// Code-enforce the staleness cutoff across a whole assembled brief just before it
// is saved (PER-250). Each `## topic` section is filtered independently: a topic
// whose normalized key is in `evergreenKeys` is left untouched (it opted into
// older content); every other section has its ordinary stories older than
// `cutoffDays` dropped. The preamble (`# Your brief`) and section order are
// preserved, and untouched sections come back byte-identical. Pure: `now` and the
// evergreen set are passed in so it is fully unit-testable without a clock.
export function enforceBriefFreshness(
  markdown: string,
  opts: { now: Date; evergreenKeys: Set<string>; cutoffDays?: number },
): string {
  const cutoffDays = opts.cutoffDays ?? FRESHNESS_CUTOFF_DAYS;
  const nowMs = opts.now.getTime();
  const { pre, blocks } = sectionBlocks(markdown);
  const rebuilt = blocks.map((b) =>
    opts.evergreenKeys.has(b.key)
      ? b.raw
      : filterStaleStoriesFromBlock(b.raw, nowMs, cutoffDays),
  );
  // sectionBlocks split losslessly (the `## ` delimiter stays at each block's
  // start), so plain concatenation reproduces the document; filtered blocks keep
  // their own trailing newline so headings stay line-anchored.
  return pre + rebuilt.join("");
}

// Assemble per-interest sections into one brief (C2/PER-171). Each entry is a
// requested interest's topic plus the section extractTopicSection produced for
// it (or null when its session yielded nothing usable). Order follows the
// requested-interest order. Topics with a null section are OMITTED — the brief
// stays honest (computeCoverage reports them "missing") rather than fabricating
// an empty section. The `# Your brief` H1 the renderer expects is prepended once.
export function assembleBrief(
  sections: Array<{ topic: string; section: string | null }>,
): string {
  const body = sections
    .map((s) => s.section)
    .filter((s): s is string => s !== null)
    .map((s) => (s.endsWith("\n") ? s : s + "\n"))
    .join("\n");
  return `# Your brief\n\n${body}`;
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
