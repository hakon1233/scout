// The local account relay (docs/ARCHITECTURE.md, "Local account relay"):
// /chat, /publish and the /team/picks routes with fetch routed to a stub
// Supabase and a Claude client that fails the test if called. No network,
// never the real `claude`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOCAL_ACCOUNT_MESSAGE, PICKS_VERSION } from "@scout/core";
import type { ClaudeClient, MessagesResponse } from "@scout/research";
import { handleRequest } from "../src/http.ts";

const SUPABASE = "https://ref.supabase.test";
const ORIGIN = "https://app.example.test";
const USER = "00000000-0000-0000-0000-0000000000a1";
const TURN = "00000000-0000-0000-0000-0000000000c1";
const TOPIC = "00000000-0000-0000-0000-0000000000b1";

type Call = { path: string; url: string; body: Record<string, unknown> };

function createText(): string {
  const url = new URL(
    "../../hosted/test/fixtures/create.json",
    import.meta.url,
  );
  const r = JSON.parse(readFileSync(url, "utf8")) as MessagesResponse;
  return (
    r.content.find((b) => b.type === "text") as unknown as { text: string }
  ).text;
}

// A stub Supabase answering by path; `local` is the reader's runs_local.
function stubSupabase(
  over: {
    local?: boolean;
    pendingTurn?: boolean;
    relayCheck?: boolean;
    pickJob?: boolean;
    claimed?: unknown[];
  } = {},
) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({
      path,
      url,
      body: init.body ? JSON.parse(init.body as string) : {},
    });
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    const gone = () =>
      new Response(JSON.stringify({ code: "P0002", message: "gone" }), {
        status: 400,
      });
    const start = {
      checkId: 42,
      title: "Fjord kayaking",
      doc: "Trips and gear.",
      displayName: "Kari",
      team: false,
      maxDocChars: 4000,
    };
    switch (path) {
      case "/auth/v1/user":
        return ok({ id: USER });
      case "/rest/v1/profiles":
        return ok([{ runs_local: over.local ?? true }]);
      case "/rest/v1/rpc/begin_chat_turn":
        return ok({ id: TURN });
      case "/rest/v1/rpc/chat_block_reason":
        return ok(null);
      case "/rest/v1/rpc/allowance":
        return ok({ limits: { max_interests: 15, max_doc_chars: 4000 } });
      case "/rest/v1/interests":
      case "/rest/v1/follows":
        return ok([]);
      case "/rest/v1/chat_turns":
        return ok(
          url.includes("status=eq.pending")
            ? over.pendingTurn === false
              ? []
              : [{ message: "Rust releases" }]
            : [],
        );
      case "/rest/v1/settings":
        return ok([{ feedback_on: false, make_on: false }]);
      case "/rest/v1/rpc/commit_chat_turn":
        return ok(null);
      case "/rest/v1/rpc/publish_start":
        return ok(start);
      case "/rest/v1/rpc/publish_relay_start":
        return over.relayCheck === false ? gone() : ok(start);
      case "/rest/v1/rpc/publish_finish":
        return ok("share-slug");
      case "/rest/v1/rpc/team_claim_picks":
        return ok(over.claimed ?? []);
      case "/rest/v1/rpc/team_pick_job":
        return over.pickJob === false
          ? gone()
          : ok({ user_id: USER, run_id: 7, kind: "weekly", input: PICKS });
      case "/rest/v1/rpc/finish_picks":
        return ok(null);
    }
    return new Response("unknown", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

// The API client a local account must never reach.
const noClaude: ClaudeClient = {
  async createMessage() {
    throw new Error("a local account called the Claude API");
  },
};

function post(
  path: string,
  body: unknown,
  fetch: typeof globalThis.fetch,
  headers: Record<string, string> = {},
  teamToken: string | undefined = "team-secret",
) {
  return handleRequest(
    new Request(`https://runs.example.test${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, authorization: "Bearer user-jwt", ...headers },
      body: JSON.stringify(body),
    }),
    {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: ORIGIN,
      serviceKey: "service-key",
      teamToken,
      claude: noClaude,
      fetch,
    },
  );
}

const relay = (step: string, token = "team-secret") => ({
  "x-scout-relay": step,
  "x-scout-relay-token": token,
});

const PICKS = {
  profile: { likedTags: ["outdoors"] },
  reading: [],
  marks: [],
  candidates: [
    { id: "i-fjord", title: "Fjord kayaking", tags: ["outdoors"], about: "" },
  ],
};

test("a local account's chat message and publish without the relay get 409 and the Mac's address", async () => {
  for (const [path, body] of [
    ["/chat", { message: "Rust releases" }],
    ["/publish", { interest: TOPIC }],
  ] as const) {
    const db = stubSupabase();
    const res = await post(path, body, db.fetch);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: LOCAL_ACCOUNT_MESSAGE });
    assert.ok(!db.calls.some((c) => c.path.includes("/rpc/")));
  }
});

test("a local account's confirm and discard still work without the relay", async () => {
  const db = stubSupabase();
  const res = await post(
    "/chat/confirm",
    { turnId: TURN, kind: "discard" },
    db.fetch,
  );
  assert.notEqual(res.status, 409);
  assert.ok(!db.calls.some((c) => c.path === "/rest/v1/profiles"));
});

test("the relay needs the token, a local account and a set TEAM_RUNNER_TOKEN", async () => {
  const body = { message: "Rust releases" };
  for (const token of ["", "nope"]) {
    const res = await post(
      "/chat",
      body,
      stubSupabase().fetch,
      relay("prompt", token),
    );
    assert.equal(res.status, 401);
  }
  const noToken = await post(
    "/chat",
    body,
    stubSupabase().fetch,
    relay("prompt"),
    "",
  );
  assert.equal(noToken.status, 404);
  const apiReader = await post(
    "/chat",
    body,
    stubSupabase({ local: false }).fetch,
    relay("prompt"),
  );
  assert.equal(apiReader.status, 403);
  const badStep = await post("/chat", body, stubSupabase().fetch, relay("go"));
  assert.equal(badStep.status, 400);
  const otherRoute = await post(
    "/runs",
    { interest: TOPIC },
    stubSupabase().fetch,
    relay("prompt"),
  );
  assert.equal(otherRoute.status, 400);
});

test("a relayed chat turn: the prompt step returns the request, the answer step lands it at no cost", async () => {
  const db = stubSupabase();
  const prompt = await post(
    "/chat",
    { message: "Rust releases" },
    db.fetch,
    relay("prompt"),
  );
  assert.equal(prompt.status, 200);
  assert.equal(prompt.headers.get("x-scout-relay"), "prompt");
  const p = (await prompt.json()) as {
    turnId: string;
    request: { model: string; messages: unknown[] };
  };
  assert.equal(p.turnId, TURN);
  assert.ok(p.request.model && p.request.messages.length > 0);
  assert.ok(db.calls.some((c) => c.path === "/rest/v1/rpc/begin_chat_turn"));
  assert.ok(!db.calls.some((c) => c.path === "/rest/v1/rpc/commit_chat_turn"));

  const answer = await post(
    "/chat",
    {
      turnId: TURN,
      text: createText(),
      usage: { inputTokens: 1200, outputTokens: 80 },
    },
    db.fetch,
    relay("answer"),
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get("x-scout-relay"), null);
  const turn = (await answer.json()) as { id: string; reply: string };
  assert.equal(turn.id, TURN);
  assert.match(turn.reply, /Rust releases/);
  const begins = db.calls.filter(
    (c) => c.path === "/rest/v1/rpc/begin_chat_turn",
  );
  assert.equal(begins.length, 1);
  const commit = db.calls.find(
    (c) => c.path === "/rest/v1/rpc/commit_chat_turn",
  );
  assert.equal(commit?.body.p_cost_usd, 0);
  const pending = db.calls.find((c) => c.url.includes("status=eq.pending"));
  assert.match(pending?.url ?? "", new RegExp(`user_id=eq.${USER}`));
});

test("a chat answer for a turn that is not waiting gets 409; garbled answers get 400", async () => {
  const db = stubSupabase({ pendingTurn: false });
  const res = await post(
    "/chat",
    { turnId: TURN, text: "{}" },
    db.fetch,
    relay("answer"),
  );
  assert.equal(res.status, 409);
  for (const body of [{ turnId: "42", text: "{}" }, { turnId: TURN }])
    assert.equal(
      (await post("/chat", body, db.fetch, relay("answer"))).status,
      400,
    );
});

test("a relayed publish check: prompt then answer reopens the same check, at no cost", async () => {
  const db = stubSupabase();
  const prompt = await post(
    "/publish",
    { interest: TOPIC },
    db.fetch,
    relay("prompt"),
  );
  assert.equal(prompt.status, 200);
  assert.equal(prompt.headers.get("x-scout-relay"), "prompt");
  const p = (await prompt.json()) as { turnId: string };
  assert.equal(p.turnId, "42");
  assert.ok(!db.calls.some((c) => c.path.endsWith("/publish_finish")));

  const answer = await post(
    "/publish",
    {
      turnId: "42",
      text: JSON.stringify({
        verdict: "approve",
        reason: "",
        tags: ["travel"],
      }),
      usage: { inputTokens: 900, outputTokens: 40 },
    },
    db.fetch,
    relay("answer"),
  );
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {
    status: "public",
    slug: "share-slug",
    tags: ["travel"],
  });
  assert.equal(
    db.calls.filter((c) => c.path.endsWith("/publish_start")).length,
    1,
  );
  const reopen = db.calls.find((c) => c.path.endsWith("/publish_relay_start"));
  assert.deepEqual(reopen?.body, { p_user: USER, p_check: 42 });
  const finish = db.calls.find((c) => c.path.endsWith("/publish_finish"));
  assert.equal(finish?.body.p_cost_usd, 0);
  assert.equal(finish?.body.p_input_tokens, 900);
  assert.equal(finish?.body.p_output_tokens, 40);
});

test("a publish answer for a check that is not open gets 409", async () => {
  const res = await post(
    "/publish",
    { turnId: "42", text: "{}" },
    stubSupabase({ relayCheck: false }).fetch,
    relay("answer"),
  );
  assert.equal(res.status, 409);
});

function teamPost(
  path: string,
  body: unknown,
  fetch: typeof globalThis.fetch,
  auth = "Bearer team-secret",
) {
  return handleRequest(
    new Request(`https://runs.example.test${path}`, {
      method: "POST",
      headers: { authorization: auth },
      body: JSON.stringify(body),
    }),
    {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: ORIGIN,
      serviceKey: "service-key",
      teamToken: "team-secret",
      claude: noClaude,
      fetch,
    },
  );
}

test("/team/picks/claim returns one prompt per claimed local reader and calls no model", async () => {
  const db = stubSupabase({
    claimed: [{ user_id: USER, run_id: 7, kind: "weekly", input: PICKS }],
  });
  assert.equal(
    (await teamPost("/team/picks/claim", {}, db.fetch, "Bearer nope")).status,
    401,
  );
  const res = await teamPost("/team/picks/claim", { limit: 99 }, db.fetch);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    prompts: { turnId: string; request: { messages: unknown[] } }[];
  };
  assert.equal(body.prompts.length, 1);
  assert.equal(body.prompts[0].turnId, "7");
  assert.ok(body.prompts[0].request.messages.length > 0);
  const claim = db.calls.find((c) => c.path.endsWith("/team_claim_picks"));
  assert.deepEqual(claim?.body, { p_limit: 5 });
  assert.ok(!db.calls.some((c) => c.path.endsWith("/finish_picks")));
});

test("/team/picks/finish replays the answer and records the picks at no cost", async () => {
  const db = stubSupabase();
  const res = await teamPost(
    "/team/picks/finish",
    {
      turnId: "7",
      text: JSON.stringify({
        picks: [{ topic: "c1", reason: "You like the outdoors." }],
      }),
      usage: { inputTokens: 4000, outputTokens: 300 },
    },
    db.fetch,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { stored: true });
  const finish = db.calls.find((c) => c.path.endsWith("/finish_picks"));
  assert.deepEqual(finish?.body, {
    p_user: USER,
    p_run: 7,
    p_picks: [{ interest_id: "i-fjord", reason: "You like the outdoors." }],
    p_cost: 0,
    p_error: null,
    p_version: PICKS_VERSION,
    p_input_tokens: 4000,
    p_output_tokens: 300,
  });

  const gone = await teamPost(
    "/team/picks/finish",
    { turnId: "7", text: "{}" },
    stubSupabase({ pickJob: false }).fetch,
  );
  assert.equal(gone.status, 404);
  const bad = await teamPost(
    "/team/picks/finish",
    { turnId: "x", text: "{}" },
    db.fetch,
  );
  assert.equal(bad.status, 400);
});
