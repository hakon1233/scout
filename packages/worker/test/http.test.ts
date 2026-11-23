// The run-now route and the Supabase queue adapter, with fetch stubbed. No
// network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/http.ts";
import { supabaseQueue } from "../src/supabase.ts";

const SUPABASE = "https://ref.supabase.test";
const ORIGIN = "https://app.example.test";
const INTEREST = "00000000-0000-0000-0000-0000000000b1";

type Call = { url: string; headers: Record<string, string>; body: unknown };

function stubFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function runNow(
  fetch: typeof globalThis.fetch,
  init: { auth?: string; body?: string; method?: string; path?: string } = {},
) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.auth !== "") headers.authorization = init.auth ?? "Bearer user-jwt";
  return handleRequest(
    new Request(`https://runs.example.test${init.path ?? "/runs"}`, {
      method: init.method ?? "POST",
      headers,
      body:
        (init.method ?? "POST") === "POST"
          ? (init.body ?? JSON.stringify({ interestId: INTEREST }))
          : undefined,
    }),
    {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: ORIGIN,
      fetch,
    },
  );
}

test("run now queues the run as the reader and answers 202 with its id", async () => {
  const { fetch, calls } = stubFetch(200, "run-1");
  const res = await runNow(fetch);

  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { runId: "run-1" });
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(calls[0].url, `${SUPABASE}/rest/v1/rpc/request_run`);
  assert.equal(calls[0].headers.apikey, "anon-key");
  assert.equal(calls[0].headers.authorization, "Bearer user-jwt");
  assert.deepEqual(calls[0].body, { p_interest: INTEREST });
});

test("run now without a token is refused before Supabase is asked", async () => {
  const { fetch, calls } = stubFetch(200, "run-1");
  const res = await runNow(fetch, { auth: "" });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("run now checks the interest id", async () => {
  const { fetch, calls } = stubFetch(200, "run-1");
  assert.equal((await runNow(fetch, { body: "{}" })).status, 400);
  assert.equal((await runNow(fetch, { body: "not json" })).status, 400);
  assert.equal(
    (await runNow(fetch, { body: JSON.stringify({ interestId: "x' or 1=1" }) }))
      .status,
    400,
  );
  assert.equal(calls.length, 0);
});

test("run now maps the SQL errors: over the daily limit, not yours, bad token", async () => {
  const quota = stubFetch(400, {
    code: "P0001",
    message: "quota: 3 of 3 on-demand runs used today",
    hint: "on_demand_runs_per_day",
  });
  const over = await runNow(quota.fetch);
  assert.equal(over.status, 429);
  assert.deepEqual(await over.json(), {
    error: "request_run: quota: 3 of 3 on-demand runs used today",
  });

  const notYours = stubFetch(400, {
    code: "P0002",
    message: "no such interest",
  });
  assert.equal((await runNow(notYours.fetch)).status, 404);

  const expired = stubFetch(401, { code: "PGRST301", message: "JWT expired" });
  assert.equal((await runNow(expired.fetch)).status, 401);

  const down = stubFetch(503, "upstream");
  assert.equal((await runNow(down.fetch)).status, 502);
});

test("the route answers CORS preflight, other paths and methods", async () => {
  const { fetch } = stubFetch(200, "run-1");
  const pre = await runNow(fetch, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal((await runNow(fetch, { method: "GET" })).status, 405);
  assert.equal((await runNow(fetch, { path: "/other" })).status, 404);
});

test("CORS allows each origin in a comma-separated list, and only those", async () => {
  const preflight = (origin: string) =>
    handleRequest(
      new Request("https://runs.example.test/runs", {
        method: "OPTIONS",
        headers: { origin },
      }),
      {
        supabaseUrl: SUPABASE,
        anonKey: "anon-key",
        allowedOrigin: `${ORIGIN}, https://test.example.test`,
      },
    );
  for (const origin of [ORIGIN, "https://test.example.test"]) {
    const res = await preflight(origin);
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
  }
  const other = await preflight("https://evil.example.test");
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("the queue adapter calls claim_runs and finish_run with the service key", async () => {
  const claim = stubFetch(200, [
    {
      run_id: "run-1",
      topic: "AI policy",
      doc: "EU",
      searches_per_run: 5,
      brief_length: "short",
      story_count: 2,
      stories_relevant_only: false,
      evergreen: false,
      search_locale: "nb-NO",
      brief_language: null,
      prior: [
        { date: "2026-11-19T07:00:00+00:00", section_md: "## AI policy" },
      ],
      cadence: "weekly",
      last_story_at: "2026-11-12T07:00:00+00:00",
      mode: "make",
      sent_keys: ["dugnad"],
    },
  ]);
  const queue = supabaseQueue({
    url: SUPABASE,
    serviceKey: "service-key",
    fetch: claim.fetch,
  });
  assert.deepEqual(await queue.claim(2), [
    {
      runId: "run-1",
      topic: "AI policy",
      doc: "EU",
      searchesPerRun: 5,
      settings: {
        length: "short",
        stories: 2,
        evergreen: false,
        searchLocale: "nb-NO",
        briefLanguage: null,
      },
      prior: [{ date: "2026-11-19T07:00:00+00:00", markdown: "## AI policy" }],
      cadence: "weekly",
      lastStoryAt: "2026-11-12T07:00:00+00:00",
      mode: "make",
      sentKeys: ["dugnad"],
    },
  ]);
  assert.equal(claim.calls[0].url, `${SUPABASE}/rest/v1/rpc/claim_runs`);
  assert.equal(claim.calls[0].headers.authorization, "Bearer service-key");
  assert.deepEqual(claim.calls[0].body, { p_limit: 2 });

  const finish = stubFetch(200, true);
  await supabaseQueue({
    url: SUPABASE,
    serviceKey: "service-key",
    fetch: finish.fetch,
  }).finish("run-1", {
    sectionMd: null,
    coverage: { topic: "AI policy", status: "missing" },
    searches: 1,
    costUsd: 0.012,
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 50,
    cacheWriteTokens: 10,
    webFetches: 2,
    model: "claude-haiku-5-5",
    stopReason: "pause_turn",
    requests: 4,
    maxPromptTokens: 60_000,
    longContext: false,
    error: "timed out after 300 s",
    retry: false,
  });
  assert.deepEqual(finish.calls[0].body, {
    p_run: "run-1",
    p_section_md: null,
    p_coverage: { topic: "AI policy", status: "missing" },
    p_searches: 1,
    p_cost_usd: 0.012,
    p_error: "timed out after 300 s",
    p_retry: false,
    p_input_tokens: 1200,
    p_output_tokens: 300,
    p_cache_read_tokens: 50,
    p_cache_write_tokens: 10,
    p_web_fetches: 2,
    p_model: "claude-haiku-5-5",
    p_stop_reason: "pause_turn",
    p_requests: 4,
    p_max_prompt_tokens: 60_000,
    p_long_context: false,
  });

  const down = stubFetch(500, { message: "boom" });
  await assert.rejects(
    supabaseQueue({ url: SUPABASE, serviceKey: "k", fetch: down.fetch }).claim(
      1,
    ),
    /claim_runs: boom/,
  );
});
