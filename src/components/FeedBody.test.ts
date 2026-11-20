// A story body is model-written markdown: it renders as rich text, never as
// raw HTML, with no inline images and with links marked as untrusted.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FeedBody from "./FeedBody.tsx";

const render = (markdown: string) =>
  renderToStaticMarkup(createElement(FeedBody, { markdown }));

test("a story body renders markdown safely", () => {
  const html = render(
    [
      "## Timeline",
      "",
      "| Step | Date |",
      "| --- | --- |",
      "| Vote | 2026-12-01 |",
      "",
      "- one",
      "- two",
      "",
      "> quoted",
      "",
      "See [the bill](https://example.org/bill) and `code`.",
      "",
      "![tracker](https://evil.example/pixel.gif)",
      "",
      '<script>alert(1)</script><img src="https://evil.example/x.gif">',
      "",
      "[bad](javascript:alert(1))",
    ].join("\n"),
  );
  assert.match(html, /<h3[^>]*>Timeline<\/h3>/);
  assert.match(
    html,
    /<table[\s\S]*<th[^>]*>Step<\/th>[\s\S]*<td[^>]*>Vote<\/td>/,
  );
  assert.match(html, /<li[^>]*>one<\/li>/);
  assert.match(html, /<blockquote/);
  assert.match(html, /<code[^>]*>code<\/code>/);
  assert.match(
    html,
    /<a href="https:\/\/example.org\/bill" target="_blank" rel="nofollow ugc noopener"/,
  );
  assert.doesNotMatch(html, /<img|evil\.example/, "no images in the body");
  assert.doesNotMatch(
    html,
    /<script|javascript:/i,
    "no raw HTML or script links",
  );
});
