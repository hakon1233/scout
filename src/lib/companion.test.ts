// The feed's mapping from a parsed brief to articles, and the last-good-brief
// fallback behind the run-failure banner.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseArticlesFromMarkdown,
  resolveLastSuccessBrief,
} from "./companion";
import type { Brief } from "./types";

test("empty markdown yields no articles and no interests", () => {
  const { articles, interests } = parseArticlesFromMarkdown("", "b1");
  assert.deepEqual(articles, []);
  assert.deepEqual(interests, []);
});

// fetchRunFailure sources the "last good brief from <date>" timestamp
// via resolveLastSuccessBrief. The single last_brief slot carries no ready brief
// on a failed/pending run, so it must fall back to the ready-brief history —
// but only then, to keep the healthy poll tick a single request.
function readyBrief(id: string, generatedAt: string): Brief {
  return { id, generatedAt, interests: [], articles: [], markdown: "" };
}

test("a ready slot is returned as the last success without fetching history", async () => {
  const slot = readyBrief("today", "2026-07-11T09:00:00.000Z");
  let historyCalls = 0;
  const result = await resolveLastSuccessBrief(slot, async () => {
    historyCalls += 1;
    return readyBrief("older", "2026-07-01T09:00:00.000Z");
  });
  assert.equal(result, slot);
  assert.equal(
    historyCalls,
    0,
    "a healthy (ready) slot must not trigger the history round-trip (poll-dedup)",
  );
});

test("an ephemeral ready slot falls back to the newest real brief", async () => {
  const ephemeral = {
    ...readyBrief("qa-run", "2026-07-16T19:06:41.414Z"),
    ephemeral: true,
  } as Brief & { ephemeral: true };
  const historic = readyBrief("scheduled", "2026-07-16T18:37:00.759Z");
  let historyCalls = 0;

  const result = await resolveLastSuccessBrief(ephemeral, async () => {
    historyCalls += 1;
    return historic;
  });

  assert.equal(historyCalls, 1, "an ephemeral slot must consult real history");
  assert.equal(result, historic);
});

test("a failed/pending slot falls back to the newest ready brief from history", async () => {
  const historic = readyBrief("last-good", "2026-07-10T09:00:00.000Z");
  let historyCalls = 0;
  const result = await resolveLastSuccessBrief(null, async () => {
    historyCalls += 1;
    return historic;
  });
  assert.equal(
    historyCalls,
    1,
    "an unready slot must consult history exactly once",
  );
  assert.equal(result, historic);
  assert.equal(result?.generatedAt, "2026-07-10T09:00:00.000Z");
});

test("a failed slot with no ready history yields null (no last-success clause)", async () => {
  const result = await resolveLastSuccessBrief(null, async () => null);
  assert.equal(result, null);
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
