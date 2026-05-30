// Unit tests for stripBriefPreamble (PER-113 #1).
//
// The headless `claude` run sometimes emits a conversational lead-in before
// the brief (e.g. "I have enough to write the brief.") that leaked into the
// rendered output. stripBriefPreamble drops anything before the first markdown
// heading. Run with: pnpm --filter @scout/agent test

import test from "node:test";
import assert from "node:assert/strict";
import { stripBriefPreamble } from "../src/research.js";

test("drops a single leading meta sentence before the brief heading", () => {
  const raw = "I have enough to write the brief.\n\n# Your brief\n\n## AI\n- thing\n";
  assert.equal(stripBriefPreamble(raw), "# Your brief\n\n## AI\n- thing");
});

test("drops a multi-line preamble before the heading", () => {
  const raw =
    "Let me search for recent news.\nOkay, here is what I found.\n\n# Your brief\n\n## X\n- y\n";
  assert.equal(stripBriefPreamble(raw), "# Your brief\n\n## X\n- y");
});

test("leaves a clean brief untouched", () => {
  const clean = "# Your brief\n\n## AI\n- thing\n  [example.com — T](https://example.com)";
  assert.equal(stripBriefPreamble(clean + "\n"), clean);
});

test("trims leading whitespace before the heading", () => {
  assert.equal(stripBriefPreamble("\n\n  \n# Your brief\n\n## A\n- b\n"), "# Your brief\n\n## A\n- b");
});

test("headingless: drops a leading prose paragraph but keeps list content", () => {
  const raw = "Here is your brief:\n\n- topic one\n- topic two\n";
  assert.equal(stripBriefPreamble(raw), "- topic one\n- topic two");
});

test("empty input stays empty", () => {
  assert.equal(stripBriefPreamble("   \n  "), "");
});
