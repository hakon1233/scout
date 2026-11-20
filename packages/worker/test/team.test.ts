// The Worker's /team routes (the Scout team runner and topic hiding), with
// Supabase stubbed. No network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { supabaseChatStore } from "../src/chat-store.ts";
import { handleRequest, type HttpDeps } from "../src/http.ts";

const SUPABASE = "https://ref.supabase.test";
const INTEREST = "5c0a7000-0000-4000-8000-000000000101";
const RUN = "00000000-0000-4000-8000-0000000000f1";

type Call = { fn: string; headers: Record<string, string>; body: unknown };

// Answers each RPC from `replies` by function name: [status, body].
function stubSupabase(replies: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const fn = url.replace(`${SUPABASE}/rest/v1/rpc/`, "");
    calls.push({
      fn,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    const [status, body] = replies[fn] ?? [404, { message: "no stub" }];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function team(
  path: string,
  body: unknown,
  deps: Partial<HttpDeps> & { fetch: typeof globalThis.fetch },
  auth = "Bearer team-secret",
) {
  return handleRequest(
    new Request(`https://runs.example.test${path}`, {
      method: "POST",
      headers: { authorization: auth, origin: "https://evil.example.test" },
      body: JSON.stringify(body),
    }),
    {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: "https://app.example.test",
      serviceKey: "service-key",
      teamToken: "team-secret",
      moderationToken: "mod-secret",
      ...deps,
    },
  );
}

test("the team routes need the team token; a wrong or missing one reaches no data", async () => {
  const sb = stubSupabase({ team_topics: [200, []] });
  for (const auth of ["", "Bearer nope", "Bearer team-secretx", "team-secret"])
    assert.equal(
      (await team("/team/topics", {}, { fetch: sb.fetch }, auth)).status,
      401,
    );
  // The moderation token is not the runner's.
  assert.equal(
    (await team("/team/topics", {}, { fetch: sb.fetch }, "Bearer mod-secret"))
      .status,
    401,
  );
  assert.equal(sb.calls.length, 0);
});

test("without TEAM_RUNNER_TOKEN set the team routes do not exist", async () => {
  const sb = stubSupabase({ team_topics: [200, []] });
  const res = await team(
    "/team/topics",
    {},
    {
      fetch: sb.fetch,
      teamToken: undefined,
    },
  );
  assert.equal(res.status, 404);
  assert.equal(sb.calls.length, 0);
});

test("the team routes send no CORS headers: a browser page cannot call them", async () => {
  const sb = stubSupabase({ team_topics: [200, []] });
  const res = await team(
    "/team/topics",
    {},
    {
      fetch: sb.fetch,
      allowedOrigin: "https://evil.example.test",
    },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("/team/topics lists the team's topics with the service key", async () => {
  const sb = stubSupabase({
    team_topics: [
      200,
      [
        {
          interest_id: INTEREST,
          topic: "Emulator releases",
          doc: "# Emulator releases",
          searches_per_run: 5,
          due: false,
        },
      ],
    ],
  });
  const res = await team("/team/topics", {}, { fetch: sb.fetch });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    topics: [
      {
        interestId: INTEREST,
        topic: "Emulator releases",
        doc: "# Emulator releases",
        searchesPerRun: 5,
        due: false,
      },
    ],
  });
  assert.equal(sb.calls[0].fn, "team_topics");
  assert.equal(sb.calls[0].headers.authorization, "Bearer service-key");
  assert.deepEqual(sb.calls[0].body, {});
});

test("/team/claim claims the team's due runs, at most 3 at a time", async () => {
  const sb = stubSupabase({
    team_claim_runs: [
      200,
      [{ run_id: RUN, topic: "T", doc: "D", searches_per_run: 5 }],
    ],
  });
  const res = await team("/team/claim", { limit: 50 }, { fetch: sb.fetch });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    runs: [{ runId: RUN, topic: "T", doc: "D", searchesPerRun: 5 }],
  });
  assert.deepEqual(sb.calls[0].body, { p_limit: 3 });
});

test("/team/start starts a one-off run; the SQL's refusals map to statuses", async () => {
  const ok = stubSupabase({
    team_start_run: [
      200,
      [{ run_id: RUN, topic: "T", doc: "D", searches_per_run: 5 }],
    ],
  });
  const res = await team(
    "/team/start",
    { interestId: INTEREST },
    { fetch: ok.fetch },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    run: { runId: RUN, topic: "T", doc: "D", searchesPerRun: 5 },
  });
  assert.deepEqual(ok.calls[0].body, { p_interest: INTEREST });

  const status = async (code: string) =>
    (
      await team(
        "/team/start",
        { interestId: INTEREST },
        {
          fetch: stubSupabase({
            team_start_run: [400, { code, message: "refused" }],
          }).fetch,
        },
      )
    ).status;
  assert.equal(await status("55000"), 409); // the runner is off
  assert.equal(await status("23505"), 409); // a run is already going
  assert.equal(await status("P0002"), 404); // not a team topic

  const bad = stubSupabase({});
  assert.equal(
    (await team("/team/start", { interestId: "x" }, { fetch: bad.fetch }))
      .status,
    400,
  );
  assert.equal(bad.calls.length, 0);
});

test("/team/runs records the run like any run (finish_run queues its pushes)", async () => {
  const sb = stubSupabase({ team_finish_run: [200, true] });
  const res = await team(
    "/team/runs",
    {
      runId: RUN,
      sectionMd: "## T\n- `2026-11-19` — story",
      coverage: { topic: "T", status: "covered" },
    },
    { fetch: sb.fetch },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(sb.calls[0].body, {
    p_run: RUN,
    p_section_md: "## T\n- `2026-11-19` — story",
    p_coverage: { topic: "T", status: "covered" },
    p_error: null,
  });
});

test("/team/runs records a failed run with its error", async () => {
  const failed = stubSupabase({ team_finish_run: [200, true] });
  await team(
    "/team/runs",
    {
      runId: RUN,
      sectionMd: null,
      coverage: { topic: "T", status: "missing" },
      error: "timed out",
    },
    { fetch: failed.fetch },
  );
  assert.deepEqual(failed.calls[0].body, {
    p_run: RUN,
    p_section_md: null,
    p_coverage: { topic: "T", status: "missing" },
    p_error: "timed out",
  });
});

test("/team/runs checks its body and refuses a run that is not the team's", async () => {
  const sb = stubSupabase({});
  for (const body of [
    {},
    { runId: RUN, sectionMd: 3, coverage: { topic: "T", status: "covered" } },
    { runId: RUN, sectionMd: "x", coverage: { topic: "T", status: "great" } },
    { runId: "x", sectionMd: "x", coverage: { topic: "T", status: "covered" } },
  ])
    assert.equal(
      (await team("/team/runs", body, { fetch: sb.fetch })).status,
      400,
    );
  assert.equal(sb.calls.length, 0);

  const notTeam = stubSupabase({
    team_finish_run: [400, { code: "P0002", message: "not a team run" }],
  });
  assert.equal(
    (
      await team(
        "/team/runs",
        {
          runId: RUN,
          sectionMd: "## T",
          coverage: { topic: "T", status: "covered" },
        },
        { fetch: notTeam.fetch },
      )
    ).status,
    404,
  );
});

test("/team/hide needs the moderation token and a reason, and hides with a logged actor", async () => {
  const sb = stubSupabase({ team_hide_interest: [200, true] });
  // The runner's token cannot hide.
  assert.equal(
    (
      await team(
        "/team/hide",
        { interestId: INTEREST, reason: "spam" },
        { fetch: sb.fetch },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await team(
        "/team/hide",
        { interestId: INTEREST, reason: "  " },
        { fetch: sb.fetch },
        "Bearer mod-secret",
      )
    ).status,
    400,
  );
  assert.equal(sb.calls.length, 0);

  const res = await team(
    "/team/hide",
    { interestId: INTEREST, reason: "Spam: affiliate links only" },
    { fetch: sb.fetch },
    "Bearer mod-secret",
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hidden: true });
  assert.deepEqual(sb.calls[0].body, {
    p_interest: INTEREST,
    p_reason: "Spam: affiliate links only",
    p_actor: "moderation-token",
  });

  const gone = stubSupabase({
    team_hide_interest: [400, { code: "P0002", message: "no such topic" }],
  });
  assert.equal(
    (
      await team(
        "/team/hide",
        { interestId: INTEREST, reason: "spam" },
        { fetch: gone.fetch },
        "Bearer mod-secret",
      )
    ).status,
    404,
  );
});

test("the setup chat never suggests a hidden public topic", async () => {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    return new Response("[]", { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  await supabaseChatStore({
    url: SUPABASE,
    serviceKey: "service-key",
    fetch,
  }).findPublicInterests("aaaaaaaa-0000-0000-0000-000000000001", "news", 5);
  const pool = urls.find((u) => u.includes("/rest/v1/interests?"));
  assert.match(pool ?? "", /visibility=eq\.public/);
  // interest_is_listed: shared or public, not deleted, not hidden.
  assert.match(pool ?? "", /interest_is_listed=is\.true/);
});

test("/team/hide does not exist without MODERATION_TOKEN", async () => {
  const sb = stubSupabase({ team_hide_interest: [200, true] });
  const res = await team(
    "/team/hide",
    { interestId: INTEREST, reason: "spam" },
    { fetch: sb.fetch, moderationToken: undefined },
    "Bearer mod-secret",
  );
  assert.equal(res.status, 404);
});
