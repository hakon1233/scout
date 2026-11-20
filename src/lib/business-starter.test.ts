// The business starter pack: trade and kommune in, filled topics out.

import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TOPIC_CHARS } from "@scout/core";
import {
  KOMMUNE_LIST,
  TRADES,
  fillTemplate,
  findKommune,
  findTrade,
  starterTopics,
} from "./business-starter";

// The free plan's intent-doc limit (plans.max_doc_chars).
const FREE_DOC_CHARS = 4000;

const trondheim = findKommune("Trondheim")!;
const restaurant = findTrade("restaurant")!;

test("fillTemplate fills names, also inside a value", () => {
  assert.equal(
    fillTemplate("{a} in {k}", { a: "news from {k}", k: "Bodø" }),
    "news from Bodø in Bodø",
  );
});

test("fillTemplate refuses a name with no value", () => {
  assert.throws(() => fillTemplate("{missing}", {}), /\{missing\}/);
});

test("fillTemplate leaves no gap for an empty optional line", () => {
  assert.equal(fillTemplate("a\n{local}\n\nb", { local: "" }), "a\n\nb");
});

test("findKommune matches the name in any case, and only a kommune", () => {
  assert.deepEqual(findKommune("  trondheim "), {
    number: "5001",
    name: "Trondheim",
  });
  assert.equal(findKommune("Oslo")?.number, "0301");
  assert.equal(findKommune("Trondheim sentrum"), null);
  assert.equal(findKommune(""), null);
  assert.equal(findKommune(null), null);
});

test("the kommune list has 357 kommuner with unique names and numbers", () => {
  assert.equal(KOMMUNE_LIST.length, 357);
  assert.equal(new Set(KOMMUNE_LIST.map((k) => k.name)).size, 357);
  assert.equal(new Set(KOMMUNE_LIST.map((k) => k.number)).size, 357);
  for (const k of KOMMUNE_LIST) assert.match(k.number, /^\d{4}$/);
});

test("a restaurant in Trondheim gets rivals and rules for Trondheim", () => {
  const [rivals, rules] = starterTopics(restaurant, trondheim);
  assert.equal(
    rivals.topic,
    "New restaurants, cafés and bars and closures in Trondheim",
  );
  assert.ok(
    rivals.doc.includes(
      "underenheter?kommunenummer=5001&naeringskode=56&sort=registreringsdatoEnhetsregisteret,desc&size=30",
    ),
  );
  assert.ok(rivals.doc.includes("beliggenhetsadresse.kommune is Trondheim"));
  assert.equal(
    rules.topic,
    "New rules for restaurants, cafés and bars in Norway",
  );
  assert.ok(
    rules.doc.includes("- Trondheim kommune decisions on skjenketider"),
  );
});

test("a county in a kommune's name stays out of the topic", () => {
  const [rivals] = starterTopics(
    findTrade("builder")!,
    findKommune("Herøy (Nordland)")!,
  );
  assert.equal(
    rivals.topic,
    "New building and installation firms and closures in Herøy",
  );
  assert.ok(rivals.doc.includes("kommunenummer=1818&naeringskode=41,43"));
});

test("a trade with no local rules leaves no empty line", () => {
  const [, rules] = starterTopics(findTrade("builder")!, trondheim);
  assert.ok(!/\n\n\n/.test(rules.doc));
  assert.ok(rules.doc.includes("new demands\n\n## Skip"));
});

test("every trade fills every topic within the free plan's limits", () => {
  const longest = KOMMUNE_LIST.reduce((a, b) =>
    b.name.length > a.name.length ? b : a,
  );
  for (const trade of TRADES) {
    assert.ok(trade.topics.length > 0, trade.id);
    for (const t of starterTopics(trade, longest)) {
      const where = `${trade.id}/${t.id}`;
      assert.ok(!/\{[a-z_]+\}/.test(t.doc + t.topic), where);
      assert.ok(t.doc.length <= FREE_DOC_CHARS, `${where}: ${t.doc.length}`);
      assert.ok(t.topic.length <= MAX_TOPIC_CHARS, where);
      assert.ok(t.doc.startsWith(`# ${t.topic.split(" in ")[0]}`), where);
    }
  }
});

test("trade ids and labels are unique", () => {
  assert.equal(new Set(TRADES.map((t) => t.id)).size, TRADES.length);
  assert.equal(new Set(TRADES.map((t) => t.label)).size, TRADES.length);
});
