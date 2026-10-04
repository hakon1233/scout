// The brief markdown grammar, read side: what a brief's sections, stories and
// citations are. Fixtures are literal briefs in the format the search skills
// ask the model for.

import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, parseBrief } from "../src/brief-document.js";

const brief = (...lines: string[]) => lines.join("\n") + "\n";

test("a story carries its topic, date, summary, citation, image and body", () => {
  const { entries, topics } = parseBrief(
    brief(
      "# Your brief",
      "",
      "## AI agents",
      "- `2026-09-30` — **OpenAI** ships an agents SDK.",
      "  [example.com — SDK released](https://example.com/sdk)",
      "  ![source image](https://cdn.example.com/lead.png)",
      "  > The lead paragraph.",
      "  >",
      "  > A second paragraph.",
    ),
  );
  assert.deepEqual(topics, ["AI agents"]);
  assert.deepEqual(entries, [
    {
      kind: "story",
      topic: "AI agents",
      date: "2026-09-30",
      summary: "OpenAI ships an agents SDK.",
      links: [
        { label: "example.com — SDK released", url: "https://example.com/sdk" },
      ],
      image: "https://cdn.example.com/lead.png",
      body: "The lead paragraph.\n\nA second paragraph.",
      raw: [
        "- `2026-09-30` — **OpenAI** ships an agents SDK.",
        "  [example.com — SDK released](https://example.com/sdk)",
        "  ![source image](https://cdn.example.com/lead.png)",
        "  > The lead paragraph.",
        "  >",
        "  > A second paragraph.",
      ].join("\n"),
    },
  ]);
});

test("`undated` and a missing date marker both leave the date null", () => {
  const { entries } = parseBrief(
    brief(
      "## Topic",
      "- `undated` — Explicitly undated.",
      "  [a.com — A](https://a.com/a)",
      "- No marker at all.",
      "  [b.com — B](https://b.com/b)",
    ),
  );
  assert.deepEqual(
    entries.map((e) => (e.kind === "story" ? [e.date, e.summary] : null)),
    [
      [null, "Explicitly undated."],
      [null, "No marker at all."],
    ],
  );
});

test("an en dash or no dash after the date is accepted", () => {
  const { entries } = parseBrief(
    brief("## T", "- `2026-09-29` – En dash.", "- `2026-09-28` No dash."),
  );
  assert.deepEqual(
    entries.map((e) => (e.kind === "story" ? e.summary : null)),
    ["En dash.", "No dash."],
  );
});

test("links in the bullet line and continuation lines are citations, in order", () => {
  const { entries } = parseBrief(
    brief(
      "## T",
      "* `2026-09-28` — See [the post](https://x.com/post).",
      "  [a.com — First](https://a.com/1) and [b.com — Second](https://b.com/2)",
    ),
  );
  const [story] = entries;
  assert.equal(story.kind, "story");
  assert.deepEqual(
    story.kind === "story" ? story.links.map((l) => l.url) : [],
    ["https://x.com/post", "https://a.com/1", "https://b.com/2"],
  );
});

test("images and blockquote links are never citations", () => {
  const { entries } = parseBrief(
    brief(
      "## T",
      "- `2026-09-28` — Story.",
      "  ![source image](https://cdn.x.com/one.png) ![second](https://cdn.x.com/two.png)",
      "  > Body with a [link](https://x.com/in-body).",
    ),
  );
  const [story] = entries;
  assert.ok(story.kind === "story");
  assert.deepEqual(story.links, []);
  assert.equal(story.image, "https://cdn.x.com/one.png");
  assert.equal(story.body, "Body with a [link](https://x.com/in-body).");
});

test("a URL with one level of balanced parens is kept whole", () => {
  const { entries } = parseBrief(
    brief(
      "## T",
      "- `2026-09-28` — Story.",
      "  [cdn — File](https://cdn.x.com/a%20(13).pdf)",
      "  ![source image](https://cdn.x.com/img%20(2).png)",
    ),
  );
  const [story] = entries;
  assert.ok(story.kind === "story");
  assert.equal(story.links[0].url, "https://cdn.x.com/a%20(13).pdf");
  assert.equal(story.image, "https://cdn.x.com/img%20(2).png");
});

test("prose after a citation's closing paren is not part of its URL", () => {
  const { entries } = parseBrief(
    brief(
      "## T",
      "- `2026-09-28` — Story.",
      "  [cdn — File](https://cdn.x.com/AI%20(13).png) (see also)",
    ),
  );
  assert.ok(entries[0].kind === "story");
  assert.equal(entries[0].links[0].url, "https://cdn.x.com/AI%20(13).png");
});

test("a citation outside any story is its own entry, with no topic before the first heading", () => {
  const { entries } = parseBrief(
    brief(
      "Intro with a [loose link](https://x.com/loose).",
      "## T",
      "Section intro citing [c.org — C](https://c.org/c).",
    ),
  );
  assert.deepEqual(entries, [
    {
      kind: "citation",
      topic: null,
      label: "loose link",
      url: "https://x.com/loose",
    },
    {
      kind: "citation",
      topic: "T",
      label: "c.org — C",
      url: "https://c.org/c",
    },
  ]);
});

test("topics list each heading once, in order; `#` and `###` are not topics", () => {
  const { topics } = parseBrief(
    brief("# Your brief", "## A", "### Not a topic", "## B", "## A"),
  );
  assert.deepEqual(topics, ["A", "B"]);
});

test("a story without a body has a null body, not an empty string", () => {
  const { entries } = parseBrief(brief("## T", "- `2026-09-28` — Story."));
  assert.ok(entries[0].kind === "story");
  assert.equal(entries[0].body, null);
});

test("inline emphasis and links collapse to plain text in the summary", () => {
  const { entries } = parseBrief(
    brief(
      "## T",
      "- `2026-09-28` — **Big** _news_ about [Thing](https://x.com/t) `v2`.",
    ),
  );
  assert.ok(entries[0].kind === "story");
  assert.equal(entries[0].summary, "Big news about Thing v2.");
});

test("canonicalUrl drops the hash, query and trailing slash", () => {
  assert.equal(
    canonicalUrl("https://x.com/story/?utm_source=a#top"),
    "https://x.com/story",
  );
  assert.equal(canonicalUrl("not a url"), "not a url");
});
