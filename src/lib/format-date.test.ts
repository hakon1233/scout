import assert from "node:assert/strict";
import test from "node:test";
import { formatDocDate } from "./format-date";

test("formatDocDate: empty for a missing or unreadable date", () => {
  assert.equal(formatDocDate(undefined), "");
  assert.equal(formatDocDate(""), "");
  assert.equal(formatDocDate("not a date"), "");
});

test("formatDocDate: the year only when asked", () => {
  const iso = "2026-11-20T12:00:00Z";
  assert.match(formatDocDate(iso), /2026/);
  assert.doesNotMatch(formatDocDate(iso, { year: false }), /2026/);
});
