import assert from "node:assert/strict";
import test from "node:test";
import {
  pageRobots,
  robotsFile,
  sitemapFile,
  topicIndexable,
  indexedSite,
} from "./seo";

const REAL = { SCOUT_INDEXED_SITE: "https://scout.example/" };
const NONE = {};

test("without the switch, no build is the real site", () => {
  assert.equal(indexedSite(NONE), null);
  assert.equal(indexedSite({ SCOUT_INDEXED_SITE: "" }), null);
  assert.equal(indexedSite(REAL), "https://scout.example/");
});

test("a switch that isn't an https URL stops the build", () => {
  assert.throws(() => indexedSite({ SCOUT_INDEXED_SITE: "yes" }));
  assert.throws(() =>
    indexedSite({ SCOUT_INDEXED_SITE: "http://scout.example/" }),
  );
});

test("the test site is noindex on every page, indexed ones too", () => {
  for (const page of ["/", "/app/browse/", "/i/", null] as const)
    assert.deepEqual(pageRobots(page, NONE), { index: false, follow: false });
});

test("the real site indexes only the hand-picked pages", () => {
  for (const page of ["/", "/app/browse/", "/i/"] as const)
    assert.deepEqual(pageRobots(page, REAL), { index: true, follow: true });
  assert.deepEqual(pageRobots(null, REAL), { index: false, follow: false });
});

test("only a public Scout team topic is indexed", () => {
  assert.equal(topicIndexable({ visibility: "public", team: true }), true);
  assert.equal(topicIndexable({ visibility: "public", team: false }), false);
  assert.equal(topicIndexable({ visibility: "shared", team: true }), false);
});

test("robots.txt: the test site lets crawlers in to read noindex, with no sitemap", () => {
  assert.deepEqual(robotsFile(NONE), {
    rules: { userAgent: "*", allow: "/" },
  });
});

test("robots.txt on the real site points at the sitemap", () => {
  assert.deepEqual(robotsFile(REAL), {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://scout.example/sitemap.xml",
  });
});

test("the sitemap lists the landing and Browse on the real site, nothing on the test site", () => {
  assert.deepEqual(sitemapFile(NONE), []);
  assert.deepEqual(
    sitemapFile(REAL).map((e) => e.url),
    ["https://scout.example/", "https://scout.example/app/browse/"],
  );
});
