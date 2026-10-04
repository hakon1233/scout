// The per-topic coverage, section-merge and freshness engine. Hermetic:
// no claude, no network, no filesystem.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTopic,
  computeCoverage,
  mergeBriefSections,
  extractTopicSection,
  sortSectionStoriesNewestFirst,
  enforceBriefFreshness,
  interestWantsEvergreen,
} from "../src/coverage.js";
import { defaultInterestDoc } from "../src/docs.js";

test("normalizeTopic collapses casing, punctuation and whitespace", () => {
  assert.equal(normalizeTopic("OpenAI"), "openai");
  assert.equal(normalizeTopic("Open AI"), "openai");
  assert.equal(normalizeTopic("Open-AI"), "openai");
  assert.equal(normalizeTopic("  Claude   Code "), "claudecode");
  assert.equal(normalizeTopic("AI!!!"), "ai");
  // The exact strings from the bug report normalize to stable keys.
  assert.equal(normalizeTopic("startup news"), "startupnews");
});

for (const { name, interests, md } of [
  {
    name: "a compact interest to a spaced heading",
    interests: ["OpenAI"],
    md: [
      "# Your brief",
      "",
      "## Open AI",
      "- A release shipped.",
      "  [example.com — Release](https://example.com/release)",
    ].join("\n"),
  },
  {
    name: "lowercase interests to title-cased headings",
    interests: ["startup news", "ai", "claude code", "openai"],
    md: [
      "# Your brief",
      "",
      "## Startup News",
      "- A seed round closed.",
      "  [example.com — Seed](https://example.com/s)",
      "",
      "## AI",
      "- A new model shipped.",
      "  [example.com — Model](https://example.com/m)",
      "",
      "## Claude Code",
      "- CLI release.",
      "  [example.com — CLI](https://example.com/cli)",
      "",
      "## OpenAI",
      "- OpenAI news.",
      "  [example.com — OpenAI](https://example.com/o)",
      "",
    ].join("\n"),
  },
]) {
  test(`computeCoverage matches ${name}, keeping the interest's own wording and order`, () => {
    assert.deepEqual(
      computeCoverage(interests, md),
      interests.map((topic) => ({ topic, status: "covered" })),
    );
  });
}

test("computeCoverage flags an empty section (no fresh news) distinctly from missing", () => {
  const interests = ["ai", "anthropic", "openai"];
  const md = [
    "# Your brief",
    "",
    "## AI",
    "- A new model shipped.",
    "  [example.com — Model](https://example.com/m)",
    "",
    "## Anthropic",
    "_no fresh news_",
    "",
    // openai has NO section at all → missing.
  ].join("\n");

  const cov = computeCoverage(interests, md);
  assert.deepEqual(cov, [
    { topic: "ai", status: "covered" },
    { topic: "anthropic", status: "empty" },
    { topic: "openai", status: "missing" },
  ]);
});

test("computeCoverage treats a section with prose but no citation as empty", () => {
  // A section that exists but carries no [label](url) link can't render a
  // source — honest "empty", not "covered".
  const md = "# Your brief\n\n## AI\nSome chatter but nothing citable.\n";
  assert.deepEqual(computeCoverage(["ai"], md), [
    { topic: "ai", status: "empty" },
  ]);
});

for (const { name, line } of [
  {
    name: "an image on its own line",
    line: "  ![source image](https://example.com/lead.png)",
  },
  {
    name: "an image inline in prose",
    line: "- `2026-06-15` — Prose with an inline ![chart](https://example.com/c.png) but no source link.",
  },
]) {
  test(`computeCoverage does not count ${name} as a citation`, () => {
    const md = ["# Your brief", "", "## AI", line].join("\n");
    assert.deepEqual(computeCoverage(["ai"], md), [
      { topic: "ai", status: "empty" },
    ]);
  });
}

test("mergeBriefSections replaces only retried topics, preserves the rest", () => {
  const base = [
    "# Your brief",
    "",
    "## AI",
    "- old ai bullet.",
    "  [example.com — Old](https://example.com/old)",
    "",
    "## OpenAI",
    "_no fresh news_",
    "",
  ].join("\n");

  // A focused retry that only re-researched "openai" returns just that section.
  const patch = [
    "# Your brief",
    "",
    "## OpenAI",
    "- fresh openai bullet.",
    "  [example.com — Fresh](https://example.com/fresh)",
    "",
  ].join("\n");

  const merged = mergeBriefSections(base, patch, ["openai"]);
  // AI is preserved verbatim from the base...
  assert.match(merged, /old ai bullet/);
  // ...and OpenAI now carries the fresh content, not the stale "_no fresh news_".
  assert.match(merged, /fresh openai bullet/);
  assert.doesNotMatch(merged, /_no fresh news_/);
  // Coverage over the merged doc now shows BOTH covered.
  assert.deepEqual(computeCoverage(["ai", "openai"], merged), [
    { topic: "ai", status: "covered" },
    { topic: "openai", status: "covered" },
  ]);
});

test("mergeBriefSections appends a topic that was entirely missing from the base", () => {
  const base = "# Your brief\n\n## AI\n- ai.\n  [a.com — A](https://a.com/a)\n";
  const patch =
    "# Your brief\n\n## Codex\n- codex.\n  [a.com — C](https://a.com/c)\n";
  const merged = mergeBriefSections(base, patch, ["codex"]);
  assert.match(merged, /## AI/);
  assert.match(merged, /## Codex/);
  assert.deepEqual(computeCoverage(["ai", "codex"], merged), [
    { topic: "ai", status: "covered" },
    { topic: "codex", status: "covered" },
  ]);
});

// --- Within-section strict newest-first ordering ---------------------------

test("sortSectionStoriesNewestFirst reorders out-of-order story bullets, citation in tow", () => {
  // The exact failure shape from the bug report: newest on top, but the
  // 2nd/3rd bullets out of order (05-27 before 05-29).
  const body = [
    "- `2026-06-02` — newest.",
    "  [a.com — Newest](https://a.com/1)",
    "- `2026-05-27` — older.",
    "  [a.com — Older](https://a.com/2)",
    "- `2026-05-29` — middle.",
    "  [a.com — Middle](https://a.com/3)",
  ].join("\n");
  const sorted = sortSectionStoriesNewestFirst(body);
  const dates = [...sorted.matchAll(/`(\d{4}-\d{2}-\d{2})`/g)].map((m) => m[1]);
  assert.deepEqual(dates, ["2026-06-02", "2026-05-29", "2026-05-27"]);
  // Each citation stays with its own bullet after the move.
  assert.match(sorted, /`2026-05-29` — middle\.\n {2}\[a\.com — Middle\]/);
});

test("sortSectionStoriesNewestFirst leaves an already-ordered body byte-identical", () => {
  const body = [
    "- `2026-06-02` — a.",
    "  [a.com — A](https://a.com/1)",
    "- `2026-05-30` — b.",
    "  [a.com — B](https://a.com/2)",
  ].join("\n");
  assert.equal(sortSectionStoriesNewestFirst(body), body);
});

test("sortSectionStoriesNewestFirst sinks undated stories and preserves the intro note", () => {
  const body = [
    "_Nothing notable in the last week — showing older items._",
    "- `undated` — no date found.",
    "  [a.com — U](https://a.com/u)",
    "- `2026-05-10` — dated.",
    "  [a.com — D](https://a.com/d)",
  ].join("\n");
  const sorted = sortSectionStoriesNewestFirst(body);
  // Intro note stays on top, ahead of every bullet.
  assert.match(sorted, /^_Nothing notable/);
  const dates = [...sorted.matchAll(/`(\d{4}-\d{2}-\d{2}|undated)`/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(dates, ["2026-05-10", "undated"]);
});

test("extractTopicSection emits the section already sorted newest-first", () => {
  const sessionMd = [
    "## startup news",
    "- `2026-06-02` — newest.",
    "  [a.com — N](https://a.com/1)",
    "- `2026-05-27` — older.",
    "  [a.com — O](https://a.com/2)",
    "- `2026-05-29` — middle.",
    "  [a.com — M](https://a.com/3)",
  ].join("\n");
  const section = extractTopicSection(sessionMd, "startup news");
  assert.ok(section);
  const dates = [...section.matchAll(/`(\d{4}-\d{2}-\d{2})`/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(dates, ["2026-06-02", "2026-05-29", "2026-05-27"]);
});

// ─── Freshness validator ─────────────────────────────────────────────────────
// enforceBriefFreshness drops ordinary items older than the cutoff from an
// assembled brief before it is saved.

// A fixed "now" so the day-math is deterministic and offline.
const NOW = new Date("2026-06-15T12:00:00Z");

test("ordinary >30-day items are dropped, in-window items kept", () => {
  // ai: a stale (>30d) item plus a fresh one; openai: two fresh items.
  const brief = [
    "# Your brief",
    "",
    "## ai",
    "- `2026-06-10` — fresh model release.",
    "  [example.com — Fresh](https://example.com/fresh)",
    "- `2026-01-05` — months-old story the model snuck in.",
    "  [example.com — Stale](https://example.com/stale)",
    "",
    "## openai",
    "- `2026-06-12` — recent.",
    "  [example.com — A](https://example.com/a)",
    "- `2026-06-01` — also recent.",
    "  [example.com — B](https://example.com/b)",
    "",
  ].join("\n");
  const out = enforceBriefFreshness(brief, {
    now: NOW,
    evergreenKeys: new Set(),
  });
  // The stale ai item and its citation are gone; the fresh ai item survives.
  assert.ok(
    !out.includes("2026-01-05"),
    "stale dated bullet should be dropped",
  );
  assert.ok(!out.includes("https://example.com/stale"), "stale citation gone");
  assert.ok(out.includes("2026-06-10"), "fresh ai item kept");
  // openai had nothing stale ⇒ its section is preserved byte-identical.
  assert.ok(
    out.includes("https://example.com/a") &&
      out.includes("https://example.com/b"),
  );
  // ai stays "covered" (still has a fresh citation); openai stays "covered".
  assert.deepEqual(computeCoverage(["ai", "openai"], out), [
    { topic: "ai", status: "covered" },
    { topic: "openai", status: "covered" },
  ]);
});

test("evergreen/background interests keep older items", () => {
  const brief = [
    "# Your brief",
    "",
    "## history of computing",
    "- `2019-03-01` — a deliberately old, evergreen piece.",
    "  [example.com — Old](https://example.com/old)",
    "",
  ].join("\n");
  // The interest doc explicitly opts into historical/background context.
  assert.ok(
    interestWantsEvergreen(
      "history of computing",
      "I want background and historical context on this topic.",
    ),
  );
  const evergreenKeys = new Set([normalizeTopic("history of computing")]);
  const out = enforceBriefFreshness(brief, { now: NOW, evergreenKeys });
  // Untouched: the old item and its citation remain.
  assert.equal(out, brief);
  assert.ok(out.includes("2019-03-01"));
});

test("the default backfilled doc does NOT read as evergreen", () => {
  // The default intent doc (docs.ts defaultInterestDoc) is backfilled for every
  // interest without a hand-authored .md — the common case. It tells the model to
  // SKIP old context, so it must NOT trip interestWantsEvergreen; a false positive
  // there drops the topic's key into evergreenKeys and disables the >30-day
  // freshness cutoff for it, letting months-old stories through. Guards against
  // reintroducing an EVERGREEN_RE trigger word
  // (evergreen/background/historical/explainer/…) into the default doc text.
  for (const topic of ["ai coding tools", "climate", "Formula 1"]) {
    assert.equal(
      interestWantsEvergreen(topic, defaultInterestDoc(topic)),
      false,
      `default doc for "${topic}" must not opt into evergreen content`,
    );
  }
});

for (const { name, items } of [
  {
    name: "a clean section",
    items: [
      "- `2026-06-14` — yesterday.",
      "  [example.com — A](https://example.com/a)",
    ],
  },
  {
    name: "a widened 7–30 day section with its older-items note",
    items: [
      "_Nothing notable in the last week — showing older items._",
      "- `2026-05-25` — 21 days old, within the 30-day window.",
      "  [example.com — C](https://example.com/c)",
      "- `2026-05-20` — 26 days old, still within the window.",
      "  [example.com — D](https://example.com/d)",
    ],
  },
  {
    name: "an item exactly 30 calendar days old",
    items: [
      "- `2026-05-16` — exactly 30 calendar days before NOW.",
      "  [example.com — Boundary](https://example.com/boundary)",
    ],
  },
  {
    name: "an undated item",
    items: [
      "- `2026-06-10` — fresh.",
      "  [example.com — F](https://example.com/f)",
      "- `undated` — no determinable date.",
      "  [example.com — U](https://example.com/u)",
    ],
  },
]) {
  test(`enforceBriefFreshness returns ${name} unchanged`, () => {
    const brief = ["# Your brief", "", "## ai", ...items, ""].join("\n");
    assert.equal(
      enforceBriefFreshness(brief, { now: NOW, evergreenKeys: new Set() }),
      brief,
    );
  });
}

test("per-topic no-news state recorded when everything drops", () => {
  // Every item is stale AND the model had wrongly emitted the older-items note.
  const brief = [
    "# Your brief",
    "",
    "## crypto",
    "_Nothing notable in the last week — showing older items._",
    "- `2026-02-01` — stale.",
    "  [example.com — S1](https://example.com/s1)",
    "- `2026-01-15` — staler.",
    "  [example.com — S2](https://example.com/s2)",
    "",
  ].join("\n");
  const out = enforceBriefFreshness(brief, {
    now: NOW,
    evergreenKeys: new Set(),
  });
  // No stale citations remain, the now-false note is gone, and the section is
  // rewritten to an honest no-news marker.
  assert.ok(!out.includes("https://example.com/s1"));
  assert.ok(!out.includes("https://example.com/s2"));
  assert.ok(!out.includes("showing older items"));
  assert.ok(/_no fresh news_/.test(out));
  // computeCoverage now reports the topic as an honest "empty", not "covered".
  assert.deepEqual(computeCoverage(["crypto"], out), [
    { topic: "crypto", status: "empty" },
  ]);
});

test("interestWantsEvergreen matches topic wording too, not just the doc", () => {
  assert.ok(interestWantsEvergreen("WW2 history", ""));
  assert.ok(interestWantsEvergreen("ai explainer", ""));
  assert.ok(!interestWantsEvergreen("ai", "latest model releases this week"));
});
