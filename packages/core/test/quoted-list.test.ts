import test from "node:test";
import assert from "node:assert/strict";
import { quotedList } from "../src/index.ts";

test("quotedList joins names the way a sentence does", () => {
  assert.equal(quotedList([]), "");
  assert.equal(quotedList(["AI"]), '"AI"');
  assert.equal(quotedList(["AI", "Chips"]), '"AI" and "Chips"');
  assert.equal(quotedList(["a", "b", "c"]), '"a", "b" and "c"');
});
