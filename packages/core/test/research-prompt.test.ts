// The research prompt builder: shared search skills, the interest's doc and
// the date anchor all reach the prompt.

import test from "node:test";
import assert from "node:assert/strict";
import {
  API_RESEARCH_TOOLS,
  buildResearchPrompt,
} from "../src/research-prompt.ts";
import { SEARCH_SKILLS, STORY_DATE_RE } from "../src/search-skills.ts";
import { DEFAULT_BRIEF_SETTINGS } from "../src/brief-settings.ts";
import { RELEVANCE_SKILLS } from "../src/relevance-skills.ts";

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
  // Everything turns on this: the per-interest intent doc
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

test("today's date uses the local calendar day, not UTC", () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "Europe/Oslo";
  try {
    const prompt = buildResearchPrompt(
      { topic: "ai", doc: "track ai" },
      new Date(2026, 5, 2, 0, 30, 0, 0),
    );
    assert.match(prompt, /Today's date is 2026-06-02/);
  } finally {
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
  }
});

test("the prompt scopes the session to the single topic and its output section", () => {
  const prompt = buildResearchPrompt({
    topic: "claude code",
    doc: "track claude code",
  });
  // Single-interest session: the topic appears as the session scope and as the
  // exactly-one `## <topic>` output section the assembler later extracts.
  assert.match(prompt, /single topic: "claude code"/);
  assert.match(prompt, /## claude code/);
  // The empty-topic line is still mandated so coverage stays honest.
  assert.match(prompt, /`No news yet\.`/);
});

test("the prompt names the web tools of the session that runs it", () => {
  const interest = { topic: "ai", doc: "track ai" };
  const cli = buildResearchPrompt(interest);
  assert.match(cli, /Use the WebSearch tool/);
  assert.match(cli, /Use WebFetch on the/);
  const api = buildResearchPrompt(interest, new Date(), API_RESEARCH_TOOLS);
  assert.match(api, /Use the web_search tool/);
  assert.match(api, /Use web_fetch on the/);
  assert.doesNotMatch(api, /WebSearch|WebFetch/);
});

test("brief settings shape the output rules", () => {
  const base = { topic: "ai", doc: "track ai" };
  const normal = buildResearchPrompt(base);
  assert.match(normal, /0-4 story bullets/);
  assert.match(normal, /1-3 paragraph\(s\)/);
  assert.match(normal, /under ~700 words/);
  assert.doesNotMatch(normal, /marked evergreen/);
  assert.doesNotMatch(normal, /Search in/);

  const tuned = buildResearchPrompt({
    ...base,
    settings: {
      length: "short",
      stories: 2,
      evergreen: true,
      searchLocale: "nb-NO",
      briefLanguage: "en",
    },
  });
  assert.match(tuned, /0-2 story bullets \(never more than 2\)/);
  assert.match(tuned, /1 paragraph\(s\)/);
  assert.match(tuned, /under ~350 words/);
  assert.match(tuned, /marked evergreen/);
  assert.match(
    tuned,
    /Search in Norwegian Bokmål \(Norway\).*write the section in English/,
  );

  const relevant = buildResearchPrompt({
    ...base,
    settings: {
      ...DEFAULT_BRIEF_SETTINGS,
      stories: "relevant",
      length: "long",
    },
  });
  assert.match(relevant, /0-4 story bullets/);
  assert.match(relevant, /3-5 paragraph\(s\)/);
});

test("the last two briefs' stories reach the prompt as already reported", () => {
  const brief = (date: string, n: number) => ({
    date,
    markdown: [
      "# Your brief",
      "",
      "## ai",
      `- \`${date}\` — Story ${n}.`,
      `  [example.org — Title ${n}](https://example.org/${n})`,
      "",
      "## other topic",
      "- `2026-06-01` — Not this topic.",
      "  [example.org — Elsewhere](https://example.org/x)",
    ].join("\n"),
  });
  const prompt = buildResearchPrompt({
    topic: "ai",
    doc: "track ai",
    prior: [
      brief("2026-06-09", 3),
      brief("2026-06-02", 2),
      brief("2026-05-26", 1),
    ],
  });
  assert.match(prompt, /Stories already posted/);
  assert.match(prompt, /2 of the last 2 briefs posted a story/);
  assert.match(
    prompt,
    /`2026-06-09` example.org — Title 3 — https:\/\/example.org\/3/,
  );
  assert.match(prompt, /Title 2/);
  assert.doesNotMatch(prompt, /Title 1/, "only the last two briefs");
  assert.doesNotMatch(prompt, /Elsewhere/, "only this topic's stories");
  assert.match(prompt, /`No change since 2026-06-09\.`/);
  assert.doesNotMatch(prompt, /^  `No news yet\.`$/m);
});

test("a doc with Sources, check first is read before searching", () => {
  const plain = buildResearchPrompt({ topic: "ai", doc: "track ai" });
  assert.doesNotMatch(plain, /Sources, check first/);
  const doc = "# ai\n\n## Sources, check first\n- https://example.org/news\n";
  const prompt = buildResearchPrompt({ topic: "ai", doc });
  assert.match(prompt, /Use WebFetch on each of those\s+sources FIRST/);
});

test("every prompt carries the shared relevance rules, the cadence and the silence", () => {
  const now = new Date(2026, 10, 20, 9);
  const quiet = buildResearchPrompt(
    { topic: "Sea ice", doc: "x", cadence: "weekly", lastPosted: "2026-11-06" },
    now,
  );
  assert.ok(
    quiet.includes(RELEVANCE_SKILLS),
    "the rules are injected verbatim",
  );
  assert.match(quiet, /Cadence: weekly\./);
  assert.match(quiet, /Last posted story: 2026-11-06 \(14 days ago\)/);
  assert.match(quiet, /`No change since 2026-11-06\.`/);
  const fresh = buildResearchPrompt(
    { topic: "Sea ice", doc: "x", cadence: "daily", lastPosted: null },
    now,
  );
  assert.match(fresh, /Last posted story: never/);
  assert.match(fresh, /`No news yet\.`/);
});
