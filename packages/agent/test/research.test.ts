// Unit tests for the research prompt builder + the shared search-skills layer
// (PER-176). The founder's pain: runs surfaced months-old stories with no
// dates. The fix is one canonical, version-controlled "skills folder" fragment
// injected verbatim into every research session, plus a date-first bullet
// contract. These tests pin that the fragment actually reaches the prompt and
// that its non-negotiable rules are present. Run: pnpm --filter @scout/agent test

import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchPrompt } from "../src/research.js";
import { SEARCH_SKILLS, STORY_DATE_RE } from "../src/search-skills.js";

test("the built prompt contains the shared search-skills fragment VERBATIM", () => {
  const prompt = buildResearchPrompt({ topic: "ai", doc: "track ai" });
  // The whole canonical fragment must appear as one contiguous block — this is
  // the "skills folder all the search agents use". If this breaks, the shared
  // layer stopped being injected (or got copy-pasted/edited out of band).
  assert.ok(
    prompt.includes(SEARCH_SKILLS),
    "research prompt must inject SEARCH_SKILLS verbatim",
  );
});

test("THE INVARIANT: the interest's doc is injected into the prompt VERBATIM", () => {
  // The whole epic turns on this (PER-139/PER-171): the per-interest intent doc
  // MUST reach the actual research prompt byte-for-byte. If editing a doc doesn't
  // change the next run's prompt, the control is dead. A distinctive body proves
  // it's the doc — not the topic or the shared skills — that landed.
  const doc = [
    "# ai",
    "",
    "Only Anthropic + OpenAI MODEL RELEASES. ZZ_UNIQUE_DOC_MARKER_42.",
    "Ignore funding-round and exec-shuffle noise.",
  ].join("\n");
  const prompt = buildResearchPrompt({ topic: "ai", doc });
  assert.ok(
    prompt.includes(doc),
    "research prompt must inject the interest's doc verbatim",
  );
  // And the composition order holds: shared skills BEFORE the doc, doc BEFORE
  // the date anchor (HOW to research → WHAT to research → recency anchor).
  const skillsAt = prompt.indexOf(SEARCH_SKILLS);
  const docAt = prompt.indexOf("ZZ_UNIQUE_DOC_MARKER_42");
  const dateAt = prompt.indexOf("Today's date is");
  assert.ok(skillsAt >= 0 && docAt >= 0 && dateAt >= 0);
  assert.ok(skillsAt < docAt, "search skills must precede the doc");
  assert.ok(docAt < dateAt, "the doc must precede the date anchor");
});

test("the search-skills fragment enforces the recency + date + sourcing rules", () => {
  // Recency window and the explicit widen-with-a-note rule.
  assert.match(SEARCH_SKILLS, /LAST 7 DAYS/);
  assert.match(SEARCH_SKILLS, /LAST 30 DAYS/);
  assert.match(SEARCH_SKILLS, /showing older items/);
  assert.match(SEARCH_SKILLS, /NEVER silently present months-old/i);
  // Mandatory per-story publish date, captured as a field.
  assert.match(SEARCH_SKILLS, /publish date/i);
  assert.match(SEARCH_SKILLS, /NEWEST FIRST/);
  // Source quality + dedupe.
  assert.match(SEARCH_SKILLS, /primary/i);
  assert.match(SEARCH_SKILLS, /[Dd]eduplicate|dedupe/);
});

test("STORY_DATE_RE extracts the date token from a model-shaped story bullet", () => {
  // A bullet exactly as the fragment specifies. The renderer parses this same
  // token into Article.publishedAt — keep both in sync.
  const dated = "- `2026-06-01` — Acme shipped a thing.";
  const undated = "- `undated` — provenance unclear.";
  assert.equal(STORY_DATE_RE.exec(dated)?.[1], "2026-06-01");
  assert.equal(STORY_DATE_RE.exec(undated)?.[1], "undated");
  // `undated` is the explicit fallback the fragment mandates (never drop the marker).
  assert.match(SEARCH_SKILLS, /`undated`/);
});

test("today's date is injected as a recency anchor", () => {
  const prompt = buildResearchPrompt(
    { topic: "ai", doc: "track ai" },
    new Date("2026-06-02T12:00:00Z"),
  );
  assert.match(prompt, /Today's date is 2026-06-02/);
});

test("the prompt scopes the session to the single topic and its output section", () => {
  const prompt = buildResearchPrompt({ topic: "claude code", doc: "track claude code" });
  // Single-interest session: the topic appears as the session scope and as the
  // exactly-one `## <topic>` output section the assembler later extracts.
  assert.match(prompt, /single topic: "claude code"/);
  assert.match(prompt, /## claude code/);
  // The empty-topic marker is still mandated so coverage stays honest.
  assert.match(prompt, /_no fresh news_/);
});
