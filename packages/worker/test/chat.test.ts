// The chat routes and their Supabase store, with fetch routed by URL to a stub
// database and a stub Claude client answering with the hosted package's
// recorded responses. No network, no database, never the real `claude`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChatTurn } from "@scout/core";
import type { ClaudeClient, MessagesResponse } from "@scout/research";
import { handleRequest } from "../src/http.ts";

const SUPABASE = "https://ref.supabase.test";
const ORIGIN = "https://app.example.test";
const USER = "00000000-0000-0000-0000-0000000000a1";

function recorded(name: string): MessagesResponse {
  const url = new URL(
    `../../hosted/test/fixtures/${name}.json`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, "utf8")) as MessagesResponse;
}

type Call = { method: string; url: string; auth: string; body: unknown };

// A stub Supabase: answers by path, and records each call.
function stubSupabase(
  over: {
    blocked?: string;
    userOk?: boolean;
    commitError?: unknown;
    publicInterests?: { id: string; topic: string }[];
  } = {},
) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      method: init.method ?? "GET",
      url,
      auth: headers.authorization,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const path = new URL(url).pathname;
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    if (path === "/auth/v1/user")
      return over.userOk === false
        ? new Response("{}", { status: 401 })
        : ok({ id: USER });
    if (path === "/rest/v1/rpc/chat_block_reason")
      return ok(over.blocked ?? null);
    if (path === "/rest/v1/rpc/allowance")
      return ok({ limits: { max_interests: 15, max_doc_chars: 4000 } });
    if (path === "/rest/v1/interests")
      return ok(
        url.includes("visibility=eq.public")
          ? (over.publicInterests ?? [])
          : [],
      );
    if (path === "/rest/v1/chat_turns") return ok([]);
    if (path === "/rest/v1/follows") return ok([]);
    if (path === "/rest/v1/rpc/commit_chat_turn")
      return over.commitError
        ? new Response(JSON.stringify(over.commitError), { status: 400 })
        : ok(null);
    return new Response("unknown", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function stubClaude(answers: MessagesResponse[]) {
  let calls = 0;
  const prompts: string[] = [];
  const claude: ClaudeClient = {
    async createMessage(request) {
      calls += 1;
      prompts.push(JSON.stringify(request));
      const next = answers.shift();
      if (!next) throw new Error("no recorded response left");
      return next;
    },
  };
  return { claude, calls: () => calls, prompts };
}

function post(
  path: string,
  body: unknown,
  fetch: typeof globalThis.fetch,
  claude: ClaudeClient,
  auth = "Bearer user-jwt",
) {
  return handleRequest(
    new Request(`https://runs.example.test${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, authorization: auth },
      body: JSON.stringify(body),
    }),
    {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: ORIGIN,
      serviceKey: "service-key",
      claude,
      fetch,
    },
  );
}

test("a chat turn verifies the reader, runs the chat and commits the new interest", async () => {
  const db = stubSupabase();
  const { claude } = stubClaude([recorded("create")]);
  const res = await post(
    "/chat",
    { message: "Rust releases" },
    db.fetch,
    claude,
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  const turn = (await res.json()) as ChatTurn;
  assert.equal(turn.status, "ready");
  assert.equal(turn.changes?.[0].op, "create");

  const user = db.calls.find((c) => c.url.endsWith("/auth/v1/user"));
  assert.equal(user?.auth, "Bearer user-jwt");

  const commit = db.calls.find((c) => c.url.endsWith("/rpc/commit_chat_turn"));
  assert.equal(commit?.auth, "Bearer service-key");
  const args = commit?.body as {
    p_user: string;
    p_turn: { message: string; changes: { op: string; topic: string }[] };
  };
  assert.equal(args.p_user, USER);
  assert.equal(args.p_turn.message, "Rust releases");
  assert.equal(args.p_turn.changes[0].topic, "Rust releases");
});

test("a chat turn is refused with the SQL's own words when the reader is out of turns", async () => {
  const db = stubSupabase({
    blocked: "You have used today's 40 chat messages. Try again tomorrow.",
  });
  const stub = stubClaude([recorded("create")]);
  const res = await post("/chat", { message: "Rust" }, db.fetch, stub.claude);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), {
    error: "You have used today's 40 chat messages. Try again tomorrow.",
  });
  assert.equal(stub.calls(), 0);
});

test("a chat turn that hits the interest cap in the database says so in plain words", async () => {
  const db = stubSupabase({
    commitError: {
      code: "P0001",
      message: "quota: 15 of 15 interests used",
      hint: "max_interests",
      details: null,
    },
  });
  const { claude } = stubClaude([recorded("create")]);
  const res = await post(
    "/chat",
    { message: "Rust releases" },
    db.fetch,
    claude,
  );
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), {
    error:
      "Your plan has room for 15 topics, and they're in use. Delete one first.",
  });
});

test("the chat sees the public catalog even when no word matches, best matches first", async () => {
  const db = stubSupabase({
    publicInterests: [
      { id: "p1", topic: "NTNU and Trondheim events" },
      { id: "p2", topic: "Rust language releases" },
    ],
  });
  const stub = stubClaude([recorded("create")]);
  await post("/chat", { message: "Rust releases" }, db.fetch, stub.claude);
  const prompt = stub.prompts[0];
  assert.match(prompt, /NTNU and Trondheim events/);
  assert.ok(
    prompt.indexOf("Rust language releases") <
      prompt.indexOf("NTNU and Trondheim events"),
  );
});

test("a chat turn needs a live session and a message", async () => {
  const stub = stubClaude([]);
  const expired = stubSupabase({ userOk: false });
  assert.equal(
    (await post("/chat", { message: "Rust" }, expired.fetch, stub.claude))
      .status,
    401,
  );
  const db = stubSupabase();
  assert.equal(
    (await post("/chat", { message: "Rust" }, db.fetch, stub.claude, ""))
      .status,
    401,
  );
  assert.equal(
    (await post("/chat", { message: "  " }, db.fetch, stub.claude)).status,
    400,
  );
  assert.equal(stub.calls(), 0);
});

test("a confirm with nothing pending answers 409; a malformed one 400", async () => {
  const db = stubSupabase();
  const { claude } = stubClaude([]);
  const none = await post(
    "/chat/confirm",
    { kind: "rewrite", interestId: "x" },
    db.fetch,
    claude,
  );
  assert.equal(none.status, 409);
  assert.equal(
    (await post("/chat/confirm", { kind: "delete" }, db.fetch, claude)).status,
    400,
  );
});
