import assert from "node:assert/strict";
import test from "node:test";

import { parseShareLink } from "./share-link";

// Browse's search box takes a pasted share link; anything else is a search.

const SLUG = "0123456789abcdef0123456789abcdef";

test("a share link in any of its forms gives its slug", () => {
  for (const input of [
    SLUG,
    SLUG.toUpperCase(),
    `https://scout-ideas.pages.dev/i/?s=${SLUG}`,
    `https://example.github.io/scout/i/?s=${SLUG}`,
    `scout-ideas.pages.dev/i/?s=${SLUG}`,
    `https://scout-ideas.pages.dev/i/${SLUG}`,
    `  https://scout-ideas.pages.dev/i/?s=${SLUG}  `,
  ])
    assert.equal(parseShareLink(input), SLUG, input);
});

test("searches and other links are not share links", () => {
  for (const input of [
    "",
    "climate",
    "norwegian housing prices",
    "abc123",
    `https://scout-ideas.pages.dev/app/?s=${SLUG}`,
    "https://scout-ideas.pages.dev/i/?s=not-a-slug",
    `https://scout-ideas.pages.dev/i/`,
    `${SLUG}0`,
  ])
    assert.equal(parseShareLink(input), null, input);
});
