// The feed's mapping from a parsed brief to articles, and the last-good-brief
// fallback behind the run-failure banner.

import test from "node:test";
import assert from "node:assert/strict";
import { fetchLatestBrief, parseArticlesFromMarkdown } from "./companion";

test("empty markdown yields no articles and no interests", () => {
  const { articles, interests } = parseArticlesFromMarkdown("", "b1");
  assert.deepEqual(articles, []);
  assert.deepEqual(interests, []);
});

// The feed's latest brief, read from a stubbed companion serving this page's
// origin. The single last_brief slot carries no ready brief on a failed run,
// so the read falls back to one page of ready-brief history, but only then, to
// keep the healthy poll tick a single request.
const origin = "http://scout.test";
Object.defineProperty(globalThis, "window", {
  value: { location: { origin } },
  configurable: true,
});

function serveBriefs(slot: object[], history: object[]): string[] {
  const asked: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/healthz") return new Response(null, { status: 200 });
    asked.push(url.search);
    return Response.json({
      briefs: url.searchParams.has("since") ? slot : history,
    });
  };
  return asked;
}

function wireBrief(id: string, generatedAt: string, extra: object = {}) {
  return {
    id,
    generated_at: generatedAt,
    status: "ready",
    summary_md: `## Topic\n\n- ${id}`,
    ...extra,
  };
}

test("a ready slot is the latest brief, without fetching history", async () => {
  const asked = serveBriefs(
    [wireBrief("today", "2026-07-11T09:00:00.000Z")],
    [wireBrief("older", "2026-07-01T09:00:00.000Z")],
  );
  const latest = await fetchLatestBrief("tok");
  assert.equal(latest?.id, "today");
  assert.equal(asked.length, 1, "a ready slot must not cost a history request");
});

test("an ephemeral ready slot falls back to the newest real brief", async () => {
  serveBriefs(
    [wireBrief("qa-run", "2026-07-16T19:06:41.414Z", { ephemeral: true })],
    [wireBrief("scheduled", "2026-07-16T18:37:00.759Z")],
  );
  const latest = await fetchLatestBrief("tok");
  assert.equal(latest?.id, "scheduled");
});

test("a failed slot falls back to the newest ready brief from history", async () => {
  const asked = serveBriefs(
    [wireBrief("today", "2026-07-11T09:00:00.000Z", { status: "failed" })],
    [wireBrief("last-good", "2026-07-10T09:00:00.000Z")],
  );
  const latest = await fetchLatestBrief("tok");
  assert.equal(latest?.generatedAt, "2026-07-10T09:00:00.000Z");
  assert.deepEqual(asked.slice(1), ["?limit=1&offset=0"]);
});

test("a failed slot with no ready history yields no latest brief", async () => {
  serveBriefs(
    [wireBrief("today", "2026-07-11T09:00:00.000Z", { status: "failed" })],
    [],
  );
  assert.equal(await fetchLatestBrief("tok"), null);
});

// A brief that exercises every part of the story format at once: a citation
// before any heading, the "older items" note, inline and cited links, a source
// image with parens in its URL, a blockquote body with a link in it, undated
// and date-less bullets, a star bullet with two sources, an image-only story
// and a repeated heading. The expected output is recorded from the parser.
const FULL_BRIEF =
  [
    "Intro prose with a [loose citation](https://example.com/loose).",
    "",
    "# Your brief",
    "",
    "## AI agents",
    "_Nothing notable in the last week — showing older items._",
    "- `2026-09-30` — **OpenAI** ships a new [agents SDK](https://example.com/inline) for tools.",
    "  [example.com — Agents SDK released](https://example.com/agents?utm_source=x)",
    "  ![source image](https://cdn.example.com/img%20(13).png)",
    "  > Lead paragraph about the SDK.",
    "  >",
    "  > Second paragraph with a [body link](https://example.com/body-only).",
    "- `undated` — An undated item.",
    "  [other.org — Undated piece](https://other.org/undated/)",
    "* `2026-09-28` — Star bullet with two sources.",
    "  [a.com — First](https://a.com/1) and [b.com — Second](https://b.com/2)",
    "- No date marker at all.",
    "  ![source image](https://cdn.example.com/only-image.png)",
    "",
    "## Climate tech",
    "_no fresh news_",
    "",
    "## Climate tech",
    "- `2026-09-29` – en dash story.",
    "  [c.org — Repeat heading](https://c.org/x)",
  ].join("\n") + "\n";

test("a brief using every story feature parses to the recorded articles", () => {
  // JSON round-trip: absent and undefined fields read the same to the feed.
  const parsed = JSON.parse(
    JSON.stringify(parseArticlesFromMarkdown(FULL_BRIEF, "b1")),
  );
  assert.deepEqual(parsed, {
    articles: [
      {
        id: "b1-0",
        title: "loose citation",
        url: "https://example.com/loose",
        interest: "general",
      },
      {
        id: "b1-1",
        title: "agents SDK",
        url: "https://example.com/inline",
        interest: "AI agents",
        publishedAt: "2026-09-30",
        text: "OpenAI ships a new agents SDK for tools.",
        imageUrl: "https://cdn.example.com/img%20(13).png",
        body: "Lead paragraph about the SDK.\n\nSecond paragraph with a [body link](https://example.com/body-only).",
      },
      {
        id: "b1-2",
        title: "example.com — Agents SDK released",
        url: "https://example.com/agents?utm_source=x",
        interest: "AI agents",
        publishedAt: "2026-09-30",
        text: "OpenAI ships a new agents SDK for tools.",
        imageUrl: "https://cdn.example.com/img%20(13).png",
        body: "Lead paragraph about the SDK.\n\nSecond paragraph with a [body link](https://example.com/body-only).",
      },
      {
        id: "b1-3",
        title: "other.org — Undated piece",
        url: "https://other.org/undated/",
        interest: "AI agents",
        text: "An undated item.",
      },
      {
        id: "b1-4",
        title: "a.com — First",
        url: "https://a.com/1",
        interest: "AI agents",
        publishedAt: "2026-09-28",
        text: "Star bullet with two sources.",
      },
      {
        id: "b1-5",
        title: "b.com — Second",
        url: "https://b.com/2",
        interest: "AI agents",
        publishedAt: "2026-09-28",
        text: "Star bullet with two sources.",
      },
      {
        id: "b1-6",
        title: "c.org — Repeat heading",
        url: "https://c.org/x",
        interest: "Climate tech",
        publishedAt: "2026-09-29",
        text: "en dash story.",
      },
    ],
    interests: ["AI agents", "Climate tech"],
  });
});

// A make topic's piece: Scout wrote it, so it has no link. It still shows in
// the feed, with an empty url, its title as the headline and the piece as body.
test("a piece Scout wrote, with no link, becomes one article", () => {
  const md = [
    "## Bedtime story",
    "",
    "- `2026-11-23` — The Fox Who Counted Stars",
    "  > Once upon a time.",
  ].join("\n");
  const { articles } = parseArticlesFromMarkdown(md, "b2");
  assert.deepEqual(JSON.parse(JSON.stringify(articles)), [
    {
      id: "b2-0",
      title: "The Fox Who Counted Stars",
      url: "",
      interest: "Bedtime story",
      publishedAt: "2026-11-23",
      body: "Once upon a time.",
    },
  ]);
});
