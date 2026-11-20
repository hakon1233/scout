import test from "node:test";
import assert from "node:assert/strict";
import type { ChatTurn } from "../src/index.ts";
import {
  APP_PAGES,
  SCOUT_GUIDE,
  appPage,
  chatTurnFromRow,
  chatTurnToRow,
} from "../src/index.ts";
import { buildChatPrompt, parseChatOutput } from "../src/chat-prompt.ts";

test("only allow-listed pages survive", () => {
  assert.equal(appPage("/app/settings/"), "/app/settings/");
  assert.equal(appPage("/app/settings"), undefined);
  assert.equal(appPage("https://evil.example/app/settings/"), undefined);
  assert.equal(appPage("javascript:alert(1)"), undefined);
  assert.equal(appPage("constructor"), undefined);
  assert.equal(appPage(42), undefined);
});

test("a reply's page is kept when listed and dropped otherwise", () => {
  const ok = parseChatOutput(
    '{"reply":"Open Settings.","changes":[],"page":"/app/settings/"}',
  );
  assert.equal(ok.page, "/app/settings/");
  const bad = parseChatOutput(
    '{"reply":"See here.","changes":[],"page":"https://example.com/"}',
  );
  assert.equal("page" in bad, false);
});

test("the chat prompt carries the guide and the page list", () => {
  const prompt = buildChatPrompt("How do I share a topic?", [], [], {
    maxInterests: 5,
  });
  assert.ok(prompt.includes(SCOUT_GUIDE));
  for (const path of Object.keys(APP_PAGES)) assert.ok(prompt.includes(path));
  assert.match(prompt, /"page":/);
});

test("a turn's page survives the round trip through its row", () => {
  const turn: ChatTurn = {
    id: "t3",
    created_at: "2026-11-20T08:00:00.000Z",
    status: "ready",
    message: "Where do I set my time zone?",
    reply: "In Settings.",
    changes: [],
    page: "/app/settings/",
  };
  const row = chatTurnToRow(turn);
  assert.deepEqual(row.pending, { page: "/app/settings/" });
  assert.deepEqual(chatTurnFromRow(row), turn);
});
