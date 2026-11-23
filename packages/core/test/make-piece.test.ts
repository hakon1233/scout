// Make mode in core: the chat's switch, the make prompt and the check of a piece.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRIEF_SETTINGS,
  buildChatPrompt,
  buildMakePrompt,
  makeSectionFromAnswer,
  pieceKey,
  planChatChanges,
} from "../src/index.ts";

const AI = { id: "int_ai", topic: "AI", doc: "# AI" };
const opts = { maxInterests: 15, maxDocChars: 4000, cadences: true };

test("with make mode off the chat prompt is exactly today's", () => {
  const today = buildChatPrompt("hi", [AI], [], opts);
  assert.equal(
    buildChatPrompt("hi", [AI], [], { ...opts, make: false }),
    today,
  );
  assert.doesNotMatch(today, /"mode"/);
});

test("with make mode on the chat may create a make topic", () => {
  const prompt = buildChatPrompt("hi", [AI], [], { ...opts, make: true });
  assert.match(prompt, /"mode": "make"/);
  assert.match(prompt, /Scout writes/);
});

test("a create keeps its make mode only while make mode is on", () => {
  const proposed = [
    { op: "create", topic: "Bedtime story", doc: "# Story", mode: "make" },
  ];
  const limits = { maxInterests: 3, maxTopicLen: 40, newId: () => "int_new" };
  const on = planChatChanges([], proposed, { ...limits, make: true });
  assert.equal(on.applied[0].mode, "make");
  const off = planChatChanges([], proposed, limits);
  assert.equal(off.applied[0].mode, undefined);
  const news = planChatChanges(
    [],
    [{ op: "create", topic: "AI", doc: "# AI", mode: "news" }],
    { ...limits, make: true },
  );
  assert.equal(news.applied[0].mode, undefined);
});

const NOW = new Date("2026-11-20T12:00:00");
const WORD = {
  topic: "Norsk ord for dagen",
  doc: "One Norwegian word a day, with its meaning in English.",
  mode: "make" as const,
};

test("the make prompt: intent doc, date, language, length, no web, the last 60 sent", () => {
  const sent = Array.from({ length: 70 }, (_, n) => `word ${n + 1}`);
  const prompt = buildMakePrompt(
    {
      ...WORD,
      sent,
      settings: {
        ...DEFAULT_BRIEF_SETTINGS,
        length: "short",
        briefLanguage: "nb",
      },
    },
    NOW,
  );
  assert.match(prompt, /<intent-doc>\nOne Norwegian word a day/);
  assert.match(prompt, /Today's date is 2026-11-20/);
  assert.match(prompt, /Write the piece in Norwegian Bokmål/);
  assert.match(prompt, /under ~350 words/);
  assert.match(prompt, /no web search/);
  assert.match(prompt, /No links, no citations, no images/);
  assert.doesNotMatch(prompt, /- word 10\n/);
  assert.match(prompt, /- word 11\n[^]*- word 70\n/);
});

test("a piece is covered; a repeat, a missing piece or a body-less one is not", () => {
  const piece = (title: string) =>
    `Here it is.\n\n## Norsk ord for dagen\n\`2026-11-20\` — ${title}\n  > Work done together.\n`;
  const ok = makeSectionFromAnswer(piece("dugnad"), {
    ...WORD,
    sent: ["koselig"],
  });
  assert.ok("sectionMd" in ok);
  assert.equal(ok.coverage.status, "covered");
  assert.match(
    ok.sectionMd,
    /^## Norsk ord for dagen\n- `2026-11-20` — dugnad/,
  );

  const repeat = makeSectionFromAnswer(piece("**Koselig!**"), {
    ...WORD,
    sent: ["koselig"],
  });
  assert.ok("error" in repeat && /already sent/.test(repeat.error));
  assert.ok("error" in makeSectionFromAnswer("nothing", WORD));
  assert.ok(
    "error" in
      makeSectionFromAnswer(
        "## Norsk ord for dagen\n- `2026-11-20` — dugnad\n",
        WORD,
      ),
  );
  assert.equal(
    pieceKey("  The *Fox*,  who  Counted Stars. "),
    "the fox who counted stars",
  );
});
