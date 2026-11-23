// POST /publish with fetch routed to a stub Supabase and a stub Claude client.
// No network, no database, never the real `claude`.

import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeClient } from "@scout/research";
import { handleRequest } from "../src/http.ts";

const SUPABASE = "https://ref.supabase.test";
const ORIGIN = "https://app.example.test";
const USER = "00000000-0000-0000-0000-0000000000a1";
const TOPIC = "00000000-0000-0000-0000-0000000000b1";

type Call = { url: string; auth: string; body: unknown };

function stubSupabase(
  over: { startError?: unknown; finishError?: unknown } = {},
) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      url,
      auth: headers.authorization,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const path = new URL(url).pathname;
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    const fail = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 400 });
    if (path === "/auth/v1/user") return ok({ id: USER });
    if (path === "/rest/v1/rpc/publish_start")
      return over.startError
        ? fail(over.startError)
        : ok({
            checkId: 42,
            title: "Fjord kayaking",
            doc: "Trips and gear.",
            displayName: "Kari",
            team: false,
            maxDocChars: 4000,
          });
    if (path === "/rest/v1/rpc/publish_finish") {
      if (over.finishError) return fail(over.finishError);
      const args = JSON.parse(init.body as string) as { p_approved: boolean };
      return ok(args.p_approved ? "share-slug" : null);
    }
    return new Response("unknown", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function stubClaude(answer: unknown) {
  let calls = 0;
  const claude: ClaudeClient = {
    async createMessage() {
      calls += 1;
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 900, output_tokens: 40 },
      };
    },
  };
  return { claude, calls: () => calls };
}

function post(
  body: unknown,
  fetch: typeof globalThis.fetch,
  claude: ClaudeClient,
) {
  return handleRequest(
    new Request("https://runs.example.test/publish", {
      method: "POST",
      headers: { origin: ORIGIN, authorization: "Bearer user-jwt" },
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

const APPROVE = {
  verdict: "approve",
  reason: "",
  tags: ["travel", "kayaking"],
};

test("publish verifies the reader, checks the topic and makes it public", async () => {
  const db = stubSupabase();
  const { claude, calls } = stubClaude(APPROVE);
  const res = await post({ interest: TOPIC }, db.fetch, claude);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.deepEqual(await res.json(), {
    status: "public",
    slug: "share-slug",
    tags: ["travel", "kayaking"],
  });
  assert.equal(calls(), 1);
  assert.equal(db.calls[0].url, `${SUPABASE}/auth/v1/user`);
  const start = db.calls.find((c) => c.url.endsWith("/rpc/publish_start"));
  assert.equal(start?.auth, "Bearer service-key");
  assert.deepEqual(start?.body, { p_user: USER, p_interest: TOPIC });
  const finish = db.calls.find((c) => c.url.endsWith("/rpc/publish_finish"));
  const args = finish?.body as Record<string, unknown>;
  assert.equal(args.p_user, USER);
  assert.equal(args.p_check, 42);
  assert.equal(args.p_approved, true);
  assert.deepEqual(args.p_tags, ["travel", "kayaking"]);
  assert.ok((args.p_cost_usd as number) > 0);
  assert.equal(args.p_input_tokens, 900);
  assert.equal(args.p_output_tokens, 40);
});

test("a refused topic stays private and the reader gets the reason", async () => {
  const db = stubSupabase();
  const { claude } = stubClaude({
    verdict: "refuse",
    reason: "Names a private person.",
    tags: [],
  });
  const res = await post({ interest: TOPIC }, db.fetch, claude);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    status: "refused",
    reason: "Names a private person.",
  });
  const finish = db.calls.find((c) => c.url.endsWith("/rpc/publish_finish"));
  assert.equal(
    (finish?.body as { p_reason: string }).p_reason,
    "Names a private person.",
  );
});

test("a limit answers 429 with a sentence and no model call", async () => {
  const db = stubSupabase({
    startError: {
      code: "P0001",
      hint: "publishes_per_day",
      message: "quota: 5 of 5 publishes used today",
    },
  });
  const { claude, calls } = stubClaude(APPROVE);
  const res = await post({ interest: TOPIC }, db.fetch, claude);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), {
    error: "limit",
    message: "You can publish 5 times a day. Try again tomorrow.",
  });
  assert.equal(calls(), 0);
});

test("not yours is 404, already public and changed are 409", async () => {
  const cases: [unknown, "start" | "finish", number][] = [
    [{ code: "P0002", message: "no such interest" }, "start", 404],
    [
      { code: "22023", hint: "already_public", message: "already public" },
      "start",
      409,
    ],
    [{ code: "40001", hint: "changed", message: "changed" }, "finish", 409],
  ];
  for (const [error, at, status] of cases) {
    const db = stubSupabase(
      at === "start" ? { startError: error } : { finishError: error },
    );
    const { claude } = stubClaude(APPROVE);
    const res = await post({ interest: TOPIC }, db.fetch, claude);
    assert.equal(res.status, status, JSON.stringify(error));
  }
});

test("a check that cannot run answers 503 and is recorded as refused", async () => {
  const db = stubSupabase();
  const { claude } = stubClaude(new Error("overloaded"));
  const res = await post({ interest: TOPIC }, db.fetch, claude);
  assert.equal(res.status, 503);
  const finish = db.calls.find((c) => c.url.endsWith("/rpc/publish_finish"));
  assert.equal((finish?.body as { p_approved: boolean }).p_approved, false);
});

test("publish needs a topic id", async () => {
  const db = stubSupabase();
  const { claude, calls } = stubClaude(APPROVE);
  for (const body of [{}, { interest: "x' or 1=1" }]) {
    assert.equal((await post(body, db.fetch, claude)).status, 400);
  }
  assert.equal(calls(), 0);
});
