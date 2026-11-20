import assert from "node:assert/strict";
import { test } from "node:test";
import { showTabTitle } from "./tab-title";

test("a page names its tab after its own thing and gives the old title back", () => {
  const doc = { title: "Topics · Scout" };
  const restore = showTabTitle(doc, "Rust releases");
  assert.equal(doc.title, "Rust releases · Scout");
  restore();
  assert.equal(doc.title, "Topics · Scout");
});

test("nothing to name leaves the tab alone", () => {
  const doc = { title: "Brief · Scout" };
  showTabTitle(doc, "  ")();
  assert.equal(doc.title, "Brief · Scout");
});
