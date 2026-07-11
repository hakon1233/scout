import assert from "node:assert/strict";
import test from "node:test";

import { runHistoryForTopic } from "./run-history";
import type { Brief } from "./types";

function brief(articles: Brief["articles"]): Brief {
  return {
    id: "b1",
    generatedAt: "2026-07-10T00:00:00.000Z",
    interests: ["AI", "OpenAI"],
    articles,
    markdown: "",
  };
}

test("runHistoryForTopic does not match short topic slugs inside longer words", () => {
  const runs = [
    brief([
      {
        id: "a1",
        title: "OpenAI ships a model",
        url: "https://example.com/openai",
        interest: "OpenAI",
      },
      {
        id: "a2",
        title: "AI policy update",
        url: "https://example.com/ai",
        interest: "AI",
      },
    ]),
  ];

  const history = runHistoryForTopic(runs, "AI");

  assert.equal(history.length, 1);
  assert.deepEqual(
    history[0].articles.map((article) => article.id),
    ["a2"],
  );
});

test("runHistoryForTopic still tolerates singular and plural topic labels", () => {
  const runs = [
    brief([
      {
        id: "a1",
        title: "Market recap",
        url: "https://example.com/markets",
        interest: "Markets",
      },
    ]),
  ];

  const history = runHistoryForTopic(runs, "Market");

  assert.equal(history.length, 1);
  assert.deepEqual(
    history[0].articles.map((article) => article.id),
    ["a1"],
  );
});
