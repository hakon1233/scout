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
const TURN = "00000000-0000-0000-0000-0000000000c1";

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
    deleteStatus?: number;
    feedbackOn?: boolean;
    turns?: unknown[];
    feedbackBlocked?: string;
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
    if (path === "/rest/v1/rpc/begin_chat_turn")
      return ok(over.blocked ? { blocked: over.blocked } : { id: TURN });
    if (path === "/rest/v1/rpc/prepare_account_delete") return ok(2);
    if (path === `/auth/v1/admin/users/${USER}` && init.method === "DELETE")
      return over.deleteStatus
        ? new Response("{}", { status: over.deleteStatus })
        : ok({});
    if (path === "/rest/v1/rpc/allowance")
      return ok({ limits: { max_interests: 15, max_doc_chars: 4000 } });
    if (path === "/rest/v1/interests")
      return ok(
        url.includes("interest_is_listed=is.true")
          ? (over.publicInterests ?? [])
          : [],
      );
    if (path === "/rest/v1/chat_turns") return ok(over.turns ?? []);
    if (path === "/rest/v1/settings")
      return ok([{ feedback_on: over.feedbackOn ?? false }]);
    if (path === "/rest/v1/rpc/send_feedback")
      return ok(over.feedbackBlocked ?? null);
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
      body: typeof body === "string" ? body : JSON.stringify(body),
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

test("a chat turn verifies the reader, runs the chat and stores the new topic for the confirm", async () => {
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
  assert.deepEqual(turn.changes, []);
  assert.equal(turn.pending_creates?.[0].topic, "Rust releases");

  const user = db.calls.find((c) => c.url.endsWith("/auth/v1/user"));
  assert.equal(user?.auth, "Bearer user-jwt");

  // The turn is reserved before Claude is asked, and the commit completes it.
  const begin = db.calls.find((c) => c.url.endsWith("/rpc/begin_chat_turn"));
  assert.equal(begin?.auth, "Bearer service-key");
  assert.deepEqual(begin?.body, { p_user: USER, p_message: "Rust releases" });

  const commit = db.calls.find((c) => c.url.endsWith("/rpc/commit_chat_turn"));
  assert.equal(commit?.auth, "Bearer service-key");
  const args = commit?.body as {
    p_user: string;
    p_turn: {
      message: string;
      changes: unknown[];
      pending: { creates: { topic: string }[] };
    };
  };
  assert.equal(args.p_user, USER);
  assert.equal((args.p_turn as { id?: string }).id, TURN);
  assert.equal(args.p_turn.message, "Rust releases");
  assert.deepEqual(args.p_turn.changes, []);
  assert.equal(args.p_turn.pending.creates[0].topic, "Rust releases");
  // What the turn's model call used, from the recorded reply.
  const used = commit?.body as Record<string, unknown>;
  assert.equal(used.p_input_tokens, 2150);
  assert.equal(used.p_output_tokens, 310);
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
  assert.ok(!db.calls.some((c) => c.url.endsWith("/rpc/commit_chat_turn")));
});

test("the chat reads only listed public interests and leaves reserved turns out of the transcript", async () => {
  const db = stubSupabase();
  const { claude } = stubClaude([recorded("create")]);
  await post("/chat", { message: "Rust" }, db.fetch, claude);
  const urls = db.calls.map((c) => decodeURIComponent(c.url));
  assert.ok(
    urls.some(
      (u) =>
        u.includes("/interests?") && u.includes("interest_is_listed=is.true"),
    ),
  );
  assert.ok(
    urls.some(
      (u) => u.includes("/chat_turns?") && u.includes("status=neq.pending"),
    ),
  );
});

test("a body over 16 KB is refused before it is read or Claude is asked", async () => {
  const db = stubSupabase();
  const stub = stubClaude([recorded("create")]);
  const res = await post(
    "/chat",
    JSON.stringify({ message: "x".repeat(20_000) }),
    db.fetch,
    stub.claude,
  );
  assert.equal(res.status, 413);
  assert.equal(stub.calls(), 0);
  assert.ok(!db.calls.some((c) => c.url.includes("/rpc/")));
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
    (
      await post(
        "/chat/confirm",
        { kind: "create", interestId: "x" },
        db.fetch,
        claude,
      )
    ).status,
    409,
  );
  assert.equal(
    (await post("/chat/confirm", { kind: "delete" }, db.fetch, claude)).status,
    400,
  );
});

test("delete account deletes the reader's topics, then their auth user, with the service key", async () => {
  const db = stubSupabase();
  const { claude } = stubClaude([]);
  const res = await post("/account/delete", {}, db.fetch, claude);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true });

  const paths = db.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
  assert.deepEqual(paths, [
    "GET /auth/v1/user",
    "POST /rest/v1/rpc/prepare_account_delete",
    `DELETE /auth/v1/admin/users/${USER}`,
  ]);
  assert.deepEqual(db.calls[1].body, { p_user: USER });
  assert.equal(db.calls[1].auth, "Bearer service-key");
  assert.equal(db.calls[2].auth, "Bearer service-key");
});

test("delete account needs a live session, and says so when Supabase fails", async () => {
  const { claude } = stubClaude([]);
  const expired = stubSupabase({ userOk: false });
  assert.equal(
    (await post("/account/delete", {}, expired.fetch, claude)).status,
    401,
  );
  assert.ok(!expired.calls.some((c) => c.url.includes("/rpc/")));

  const failing = stubSupabase({ deleteStatus: 500 });
  assert.equal(
    (await post("/account/delete", {}, failing.fetch, claude)).status,
    502,
  );
});

test("a feedback confirm is free: it skips the chat limit and sends the stored card through send_feedback", async () => {
  const card = {
    kind: "wish",
    summary: "Dark mode",
    text: "Please add a dark mode to the feed.",
  };
  const db = stubSupabase({
    // The reader has used today's chat messages; feedback still goes.
    blocked: "You have used today's 40 chat messages. Try again tomorrow.",
    feedbackOn: true,
    turns: [
      {
        id: TURN,
        created_at: "2026-11-20T08:00:00.000Z",
        status: "ready",
        message: "I wish it had dark mode",
        reply: "Send it to the Scout team? Confirm below.",
        changes: [],
        pending: { feedback: card },
        error_msg: null,
      },
    ],
  });
  const { claude, calls } = stubClaude([]);
  const res = await post(
    "/chat/confirm",
    { kind: "feedback" },
    db.fetch,
    claude,
  );
  assert.equal(res.status, 200);
  const turn = (await res.json()) as ChatTurn;
  assert.match(turn.reply ?? "", /Sent to the Scout team/);
  assert.equal(calls(), 0);
  assert.ok(!db.calls.some((c) => c.url.endsWith("/rpc/chat_block_reason")));
  assert.ok(!db.calls.some((c) => c.url.endsWith("/rpc/commit_chat_turn")));
  const send = db.calls.find((c) => c.url.endsWith("/rpc/send_feedback"));
  assert.equal(send?.auth, "Bearer service-key");
  const args = send?.body as {
    p_user: string;
    p_card_turn: string;
    p_feedback: unknown;
    p_turn: { message: string; reply: string; pending: unknown };
  };
  assert.equal(args.p_user, USER);
  assert.equal(args.p_card_turn, TURN);
  assert.deepEqual(args.p_feedback, card);
  assert.equal(args.p_turn.message, "Send feedback: Dark mode");
  assert.equal(args.p_turn.pending, null);
});

test("a feedback confirm with the switch off answers 409 and sends nothing", async () => {
  const db = stubSupabase({
    feedbackOn: false,
    turns: [
      {
        id: TURN,
        created_at: "2026-11-20T08:00:00.000Z",
        status: "ready",
        message: "I wish it had dark mode",
        reply: "Confirm below.",
        changes: [],
        pending: { feedback: { kind: "wish", summary: "a", text: "b" } },
        error_msg: null,
      },
    ],
  });
  const { claude } = stubClaude([]);
  const res = await post(
    "/chat/confirm",
    { kind: "feedback" },
    db.fetch,
    claude,
  );
  assert.equal(res.status, 409);
  assert.ok(!db.calls.some((c) => c.url.endsWith("/rpc/send_feedback")));
});
