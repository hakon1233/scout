// The hosted chat through its interface: a stub Claude client that answers
// with recorded responses (test/fixtures), and an in-memory store. No network.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChatTurn, Interest, InterestSnapshot } from "@scout/core";
import type {
  ClaudeClient,
  MessagesRequest,
  MessagesResponse,
} from "@scout/research";
import { CHAT_MODEL, createChat, type ChatStore } from "../src/index.ts";

type Fixture =
  | "create"
  | "delete"
  | "rewrite"
  | "follow"
  | "invented-ids"
  | "refusal"
  | "max-tokens";

function recorded(name: Fixture): MessagesResponse {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as MessagesResponse;
}

// Answers each call with the next response (or throws the next error), and
// keeps every request it got.
function stubClaude(answers: (MessagesResponse | Error)[]) {
  const requests: MessagesRequest[] = [];
  const claude: ClaudeClient = {
    async createMessage(body) {
      requests.push(body);
      const next = answers.shift();
      if (!next) throw new Error("no recorded response left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { claude, requests };
}

const AI: InterestSnapshot = {
  id: "int_ai",
  topic: "AI",
  doc: "# AI\n\nAll of it.",
};
const AI_POLICY: Interest = { id: "pub_ai_policy", topic: "AI policy" };

// The store as the hosted function's database would behave, in memory.
function memoryStore(interests: InterestSnapshot[] = [AI]) {
  const state = {
    interests: interests.map((i) => ({ ...i })),
    transcript: [] as ChatTurn[],
    follows: [] as string[],
    costUsd: 0,
  };
  const store: ChatStore = {
    async load() {
      return {
        interests: state.interests.map((i) => ({ ...i })),
        transcript: [...state.transcript],
        limits: { maxInterests: 15, maxDocChars: 4000 },
      };
    },
    async findPublicInterests(_userId, message) {
      return /policy|regulation/i.test(message) ? [AI_POLICY] : [];
    },
    async commit(_userId, { turn, follows, costUsd }) {
      for (const c of turn.changes ?? []) {
        const at = state.interests.findIndex((i) => i.id === c.interestId);
        if (c.op === "create") {
          state.interests.push({
            id: c.interestId,
            topic: c.topic!,
            doc: c.doc!,
          });
        } else if (c.op === "update") {
          state.interests[at] = {
            id: c.interestId,
            topic: c.topic!,
            doc: c.doc!,
          };
        } else {
          state.interests.splice(at, 1);
        }
      }
      state.follows.push(...follows);
      state.transcript.push(turn);
      state.costUsd += costUsd;
    },
  };
  return { store, state };
}

// The chat prompt a request carried: its one user text block.
function promptOf(request: MessagesRequest): string {
  return String(request.messages[0].content[0].text);
}

function setup(
  answers: (MessagesResponse | Error)[],
  interests?: InterestSnapshot[],
) {
  const { claude, requests } = stubClaude(answers);
  const { store, state } = memoryStore(interests);
  let n = 0;
  const chat = createChat({
    claude,
    store,
    newId: () => `id_${++n}`,
    now: () => new Date("2026-11-20T08:00:00Z"),
  });
  return { chat, requests, state };
}

test("a create lands at once with a minted id, and the turn's cost is kept", async () => {
  const { chat, requests, state } = setup([recorded("create")]);
  const turn = await chat.turn("u1", "Follow Rust releases for me");

  assert.equal(turn.status, "ready");
  assert.deepEqual(turn.changes, [
    {
      interestId: "id_2",
      op: "create",
      topic: "Rust releases",
      doc: "# Rust releases\n\nStable releases and accepted RFCs. Skip nightly churn.",
    },
  ]);
  assert.deepEqual(
    state.interests.map((i) => i.topic),
    ["AI", "Rust releases"],
  );
  // 2150 input and 310 output tokens at Haiku 5.5 prices.
  assert.ok(Math.abs(state.costUsd - 0.00037) < 1e-9);

  const [request] = requests;
  assert.equal(request.model, CHAT_MODEL);
  assert.equal(request.output_config?.format?.type, "json_schema");
  const prompt = promptOf(request);
  assert.match(prompt, /Follow Rust releases for me/);
  assert.match(prompt, /"id": "int_ai"/);
  assert.doesNotMatch(prompt, /Public interests/);
});

test("a delete waits for the confirm, which removes the interest once", async () => {
  const { chat, state } = setup([recorded("delete")]);
  const turn = await chat.turn("u1", "drop AI");

  assert.deepEqual(turn.changes, []);
  assert.deepEqual(turn.pending_deletes, [
    { interestId: "int_ai", topic: "AI" },
  ]);
  assert.equal(state.interests.length, 1);

  assert.equal(
    await chat.confirm("u1", { kind: "delete", interestIds: ["int_other"] }),
    null,
  );
  const confirmed = await chat.confirm("u1", {
    kind: "delete",
    interestIds: ["int_ai"],
  });
  assert.equal(confirmed?.reply, 'Removed "AI" from your interests.');
  assert.deepEqual(state.interests, []);
  assert.equal(
    await chat.confirm("u1", { kind: "delete", interestIds: ["int_ai"] }),
    null,
  );
});

test("a full rewrite waits, and the confirm writes the stored doc", async () => {
  const { chat, state } = setup([recorded("rewrite")]);
  const turn = await chat.turn("u1", "start AI over, frontier labs only");

  assert.equal(turn.pending_rewrite?.interestId, "int_ai");
  assert.equal(state.interests[0].doc, AI.doc);

  const confirmed = await chat.confirm("u1", {
    kind: "rewrite",
    interestId: "int_ai",
  });
  assert.equal(confirmed?.reply, 'Applied the rewrite of "AI".');
  assert.equal(
    state.interests[0].doc,
    "# AI\n\nOnly model releases from frontier labs.",
  );
});

test("a matching public interest is offered, and following it waits for the confirm", async () => {
  const { chat, requests, state } = setup([recorded("follow")]);
  const turn = await chat.turn("u1", "I want AI policy and regulation news");

  const prompt = promptOf(requests[0]);
  assert.match(prompt, /Public interests that may match/);
  assert.match(prompt, /"id": "pub_ai_policy"/);
  assert.deepEqual(turn.pending_follows, [
    { interestId: "pub_ai_policy", topic: "AI policy" },
  ]);
  assert.deepEqual(state.follows, []);

  const confirmed = await chat.confirm("u1", {
    kind: "follow",
    interestId: "pub_ai_policy",
  });
  assert.equal(confirmed?.reply, 'You now follow "AI policy".');
  assert.deepEqual(state.follows, ["pub_ai_policy"]);
  assert.deepEqual(state.interests, [AI]);
});

test("ids the model invents or wasn't offered are dropped", async () => {
  const { chat, state } = setup([recorded("invented-ids")]);
  const turn = await chat.turn("u1", "AI policy please");

  assert.equal(turn.status, "ready");
  assert.deepEqual(turn.changes, []);
  assert.equal(turn.pending_deletes, undefined);
  assert.equal(turn.pending_follows, undefined);
  assert.deepEqual(state.interests, [AI]);
});

test("a refusal, a cut-off answer or an API error fails the turn and changes nothing", async () => {
  const busy = Object.assign(new Error("overloaded"), { status: 529 });
  const { chat, state } = setup([
    recorded("refusal"),
    recorded("max-tokens"),
    busy,
  ]);
  const refused = await chat.turn("u1", "something");
  const cutOff = await chat.turn("u1", "something long");
  const failed = await chat.turn("u1", "anything");

  assert.equal(refused.status, "failed");
  assert.equal(
    refused.error_msg,
    "Claude declined to answer that. Try rephrasing.",
  );
  assert.equal(
    cutOff.error_msg,
    "Claude's answer couldn't be read. Try again.",
  );
  assert.equal(
    failed.error_msg,
    "Scout's chat is busy right now. Try again in a minute.",
  );
  assert.deepEqual(state.interests, [AI]);
  assert.equal(state.transcript.length, 3);
  // The refusal and the cut-off answer were still billed.
  assert.ok(state.costUsd > 0);
  assert.equal(
    await chat.confirm("u1", { kind: "delete", interestIds: ["int_ai"] }),
    null,
  );
});
