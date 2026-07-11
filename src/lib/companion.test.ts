// Unit tests for parseArticlesFromMarkdown (PER-271, audit finding H3).
//
// This ~100-line regex parser turns the companion's GFM brief markdown into
// the Article[] that drives the entire feed. Before this file it was only
// exercised indirectly through e2e/zero-prompt.spec.ts (which needs a full
// packed companion + browser). These tests pin the parser's behavior directly
// against the documented regressions:
//   - PER-211: citation + handpicked source image capture.
//   - PER-214: in-depth blockquote body, separate from the short feed blurb.
//   - PER-216: balanced-paren CDN/Webflow URLs (`...(13).png`) must not be
//     truncated at the first `)`.
// Plus the undated-bullet and missing/empty/covered coverage-classification
// cases called out in the issue.
//
// Run with: pnpm test (root) or tsx --test src/lib/companion.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { parseArticlesFromMarkdown } from "./companion";

test("empty markdown yields no articles and no interests", () => {
  const { articles, interests } = parseArticlesFromMarkdown("", "b1");
  assert.deepEqual(articles, []);
  assert.deepEqual(interests, []);
});

test("citation: a story bullet's [label](url) becomes an article under the current topic heading", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
  ].join("\n");
  const { articles, interests } = parseArticlesFromMarkdown(markdown, "b1");

  assert.deepEqual(interests, ["AI safety"]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].id, "b1-0");
  assert.equal(articles[0].title, "example.com — Alignment update");
  assert.equal(articles[0].url, "https://example.com/alignment");
  assert.equal(articles[0].interest, "AI safety");
  assert.equal(articles[0].text, "A lab published new alignment results.");
  assert.equal(articles[0].publishedAt, undefined);
  assert.equal(articles[0].imageUrl, undefined);
  assert.equal(articles[0].body, undefined);
});

test("citation outside any story bullet still surfaces as a standalone, dateless article", () => {
  const markdown = [
    "## Markets",
    "See also [background reading](https://example.com/bg) for context.",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "background reading");
  assert.equal(articles[0].url, "https://example.com/bg");
  assert.equal(articles[0].interest, "Markets");
  assert.equal(articles[0].text, undefined);
});

test("image (PER-211): a story's ![alt](url) line is captured as imageUrl on its citation article", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
    "  ![source image](https://example.com/hero.png)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles.length, 1);
  assert.equal(articles[0].imageUrl, "https://example.com/hero.png");
});

test("image markdown is never also collected as a citation link", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  ![source image](https://example.com/hero.png)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  // No [label](url) citation in this story — only the image line, which must
  // not itself be mistaken for a `[alt](url)` citation (LINK_RE skips `!`-prefixed
  // matches). A story with zero citation links contributes zero articles.
  assert.deepEqual(articles, []);
});

test("blockquote body (PER-214): paragraphs join with blank-line breaks and stay off the feed blurb", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
    "  > The lab reported a **measurable drop** in deceptive behavior.",
    "  >",
    "  > Independent researchers called it promising but unreplicated.",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles.length, 1);
  assert.equal(
    articles[0].body,
    "The lab reported a **measurable drop** in deceptive behavior.\n\nIndependent researchers called it promising but unreplicated.",
  );
  // The short feed blurb (`text`) never contains the in-depth body.
  assert.equal(articles[0].text, "A lab published new alignment results.");
  assert.doesNotMatch(articles[0].text!, /measurable drop/);
});

test("a story with no blockquote lines has an undefined body, not an empty string", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");
  assert.equal(articles[0].body, undefined);
});

test("undated bullets: a story bullet with no leading `date` token leaves publishedAt undefined", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");
  assert.equal(articles[0].publishedAt, undefined);
});

test("a dated bullet captures the ISO date into publishedAt and strips the date token from the blurb", () => {
  const markdown = [
    "## AI safety",
    "- `2026-06-30` — A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");
  assert.equal(articles[0].publishedAt, "2026-06-30");
  assert.equal(articles[0].text, "A lab published new alignment results.");
});

test("an explicit `undated` date token is treated the same as no date at all", () => {
  const markdown = [
    "## AI safety",
    "- `undated` — A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");
  assert.equal(articles[0].publishedAt, undefined);
  assert.equal(articles[0].text, "A lab published new alignment results.");
});

test("balanced-paren CDN URLs (PER-216): a citation URL with (N) in the filename is not truncated at the first )", () => {
  const url = "https://cdn.example.com/AI%20(13).png";
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    `  [example.com — Alignment update](${url})`,
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles[0].url, url);
});

test("balanced-paren CDN URLs (PER-216): a source image URL with (N) in the filename is not truncated", () => {
  const url = "https://cdn.example.com/AI%20(13).png";
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
    `  ![source image](${url})`,
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles[0].imageUrl, url);
});

test("balanced-paren CDN URLs (PER-216): a bare (non-paren) trailing ) still terminates the markdown link", () => {
  // Only ONE level of balanced parens is tolerated inside the URL body — the
  // markdown syntax's own closing `)` must still end the match, so a bracket
  // of plain trailing text after the link is never swallowed into the URL.
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://cdn.example.com/AI%20(13).png) (see also)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles[0].url, "https://cdn.example.com/AI%20(13).png");
  // The trailing "(see also)" text is not part of the URL and is not otherwise
  // captured — it's just prose after the citation on the same line.
  assert.ok(!articles[0].url.includes("see also"));
});

test("multiple citations under one story bullet each become their own article, sharing topic/date/blurb/image/body", () => {
  const markdown = [
    "## AI safety",
    "- `2026-06-30` — A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
    "  [rival.example.org — Rival coverage](https://rival.example.org/story)",
    "  ![source image](https://example.com/hero.png)",
    "  > In-depth context paragraph.",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");

  assert.equal(articles.length, 2);
  assert.equal(articles[0].id, "b1-0");
  assert.equal(articles[1].id, "b1-1");
  assert.equal(articles[0].title, "example.com — Alignment update");
  assert.equal(articles[1].title, "rival.example.org — Rival coverage");
  for (const a of articles) {
    assert.equal(a.interest, "AI safety");
    assert.equal(a.publishedAt, "2026-06-30");
    assert.equal(a.text, "A lab published new alignment results.");
    assert.equal(a.imageUrl, "https://example.com/hero.png");
    assert.equal(a.body, "In-depth context paragraph.");
  }
});

test("multiple ## topic headings partition stories into interests and reset currentTopic", () => {
  const markdown = [
    "## AI safety",
    "- A lab published new alignment results.",
    "  [example.com — Alignment update](https://example.com/alignment)",
    "",
    "## Markets",
    "- Indices closed higher on fresh inflation data.",
    "  [news.example.org — Markets recap](https://news.example.org/markets)",
  ].join("\n");
  const { articles, interests } = parseArticlesFromMarkdown(markdown, "b1");

  assert.deepEqual(interests, ["AI safety", "Markets"]);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].interest, "AI safety");
  assert.equal(articles[1].interest, "Markets");
});

test("a story bullet with no citation link at all contributes no articles", () => {
  const markdown = ["## AI safety", "- Nothing newsworthy to report today."].join(
    "\n",
  );
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");
  assert.deepEqual(articles, []);
});

test("article ids are sequential per brief across topics and stories", () => {
  const markdown = [
    "## AI safety",
    "- First story.",
    "  [a.example — A](https://a.example/1)",
    "  [b.example — B](https://b.example/2)",
    "## Markets",
    "- Second story.",
    "  [c.example — C](https://c.example/3)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b2");
  assert.deepEqual(
    articles.map((a) => a.id),
    ["b2-0", "b2-1", "b2-2"],
  );
});

test("inline markdown emphasis in the blurb is stripped to plain text", () => {
  const markdown = [
    "## AI safety",
    "- A lab reported a **measurable drop** and published the `eval-harness`.",
    "  [example.com — Alignment update](https://example.com/alignment)",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(markdown, "b1");
  assert.equal(
    articles[0].text,
    "A lab reported a measurable drop and published the eval-harness.",
  );
});
