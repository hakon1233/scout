// The Scout team runner end to end: the command line, the local research with
// a stubbed `claude`, and the real Worker routes (packages/worker) in process
// over a fake Supabase. No network, no real claude, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { spawn } from "node:child_process";
import { teamRunMain } from "../src/team-runner.js";
import { handleRequest } from "../../worker/src/http.ts";

const WORKER = "https://scout-runs.example.test";
const SUPABASE = "https://ref.supabase.test";
const TOKEN = "team-secret-do-not-print";
const CONFIG = { TEAM_RUNNER_TOKEN: TOKEN, SCOUT_WORKER_URL: WORKER };
const NOW = () => new Date("2026-11-20T12:00:00Z");
const DUE = "5c0a7000-0000-4000-8000-000000000108";
const PAUSED = "5c0a7000-0000-4000-8000-000000000113";

// The SQL side, as the team_* functions behave (supabase/tests/team_runner.test.sql
// pins the real ones).
function fakeSupabase(
  opts: { runnerOn?: boolean; facts?: boolean; make?: boolean } = {},
) {
  const topics = [
    { id: DUE, topic: "LLM releases, prices and retirements", due: true },
    { id: PAUSED, topic: "Emulator releases", due: false }, // paused
  ];
  const calls: string[] = [];
  const finished: Array<Record<string, unknown>> = [];
  let runs = 0;
  const row = (t: (typeof topics)[number]) => ({
    run_id: `00000000-0000-4000-8000-00000000000${++runs}`,
    topic: t.topic,
    doc: `# ${t.topic}\n## Report\nWhat changed this week.`,
    searches_per_run: 5,
    // What claim_runs also returns (run_facts): settings, the last sections,
    // the cadence and the last story's date.
    ...(opts.facts
      ? {
          brief_length: "short",
          story_count: 2,
          stories_relevant_only: false,
          evergreen: true,
          search_locale: "nb-NO",
          brief_language: "nb",
          prior: [
            {
              date: "2026-11-19T07:05:00+00:00",
              section_md: `## ${t.topic}\nNo change since 2026-11-18.`,
            },
            {
              date: "2026-11-18T07:05:00+00:00",
              section_md:
                `## ${t.topic}\n- \`2026-11-17\` — **Old news.** Said before.\n` +
                "  [example.com — The old story](https://example.com/old-story)\n",
            },
          ],
          cadence: "daily",
          last_story_at: "2026-11-18T07:05:00+00:00",
        }
      : {}),
    ...(opts.make ? { mode: "make", sent_keys: ["koselig"] } : {}),
  });
  const fetch = (async (url: string, init: RequestInit) => {
    const fn = url.replace(`${SUPABASE}/rest/v1/rpc/`, "");
    calls.push(fn);
    assert.equal(
      (init.headers as Record<string, string>).authorization,
      "Bearer service-key",
    );
    const args = JSON.parse(init.body as string);
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    switch (fn) {
      case "team_topics":
        return ok(
          topics.map((t) => ({
            interest_id: t.id,
            topic: t.topic,
            doc: `# ${t.topic}`,
            searches_per_run: 5,
            due: t.due,
          })),
        );
      case "team_claim_runs": {
        const t = opts.runnerOn ? topics.find((x) => x.due) : undefined;
        if (!t) return ok([]);
        t.due = false;
        return ok([row(t)]);
      }
      case "team_start_run": {
        if (!opts.runnerOn)
          return new Response(
            JSON.stringify({
              code: "55000",
              message: "the team runner is off",
            }),
            { status: 400 },
          );
        return ok([row(topics.find((x) => x.id === args.p_interest)!)]);
      }
      case "team_finish_run":
        finished.push(args);
        return ok(true);
      case "team_claim_picks":
        return ok([]);
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, finished, topics };
}

// The Worker, in process, as the runner's fetch.
function worker(supabase: typeof globalThis.fetch) {
  return (async (url: string, init: RequestInit) =>
    handleRequest(new Request(url, init), {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: "https://app.example.test",
      serviceKey: "service-key",
      teamToken: TOKEN,
      fetch: supabase,
    })) as unknown as typeof globalThis.fetch;
}

// A `claude` stand-in that writes a dated story under the prompt's topic.
// With `json`, it answers as `claude --output-format json` does.
function stubClaude(reply: { fail?: boolean; json?: boolean } = {}) {
  const spawns: Array<{ args: readonly string[]; prompt: string }> = [];
  const spawnFn = ((_bin: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid?: number;
    };
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let prompt = "";
    child.stdin = new Writable({
      write(c, _e, cb) {
        prompt += c.toString();
        cb();
      },
    });
    child.stdin.on("finish", () => {
      spawns.push({ args, prompt });
      const topic =
        /(?:single topic|For the topic): "([^"]+)"/.exec(prompt)?.[1] ?? "?";
      const make = prompt.includes("For the topic");
      setImmediate(() => {
        if (reply.fail) {
          child.stderr.emit("data", Buffer.from("You've hit your limit"));
          child.emit("close", 1);
          return;
        }
        const text = make
          ? `## ${topic}\n- \`2026-11-20\` — dugnad\n  > Work done together.\n`
          : `I have enough.\n\n## ${topic}\n` +
            "- `2026-11-19` — **A vendor retired a model.** It goes on 1 December.\n" +
            "  [example.com — Retirement notice](https://example.com/notice)\n";
        child.stdout.emit(
          "data",
          Buffer.from(
            reply.json
              ? JSON.stringify({
                  type: "result",
                  subtype: "success",
                  is_error: false,
                  num_turns: 5,
                  result: text,
                  stop_reason: "end_turn",
                  total_cost_usd: 0.031,
                  usage: {
                    input_tokens: 800,
                    output_tokens: 700,
                    cache_read_input_tokens: 20_000,
                    cache_creation_input_tokens: 2_000,
                    server_tool_use: { web_search_requests: 3 },
                  },
                  modelUsage: {
                    "claude-haiku-5-5": {
                      inputTokens: 800,
                      outputTokens: 700,
                      cacheReadInputTokens: 20_000,
                      cacheCreationInputTokens: 2_000,
                      webSearchRequests: 3,
                      costUSD: 0.031,
                    },
                  },
                })
              : text,
          ),
        );
        child.emit("close", 0);
      });
    });
    return child;
  }) as unknown as typeof spawn;
  return { spawnFn, spawns };
}

function setup(
  opts: {
    runnerOn?: boolean;
    fail?: boolean;
    facts?: boolean;
    json?: boolean;
    make?: boolean;
  } = {},
) {
  const sb = fakeSupabase(opts);
  const claude = stubClaude(opts);
  const lines: string[] = [];
  const deps = {
    fetch: worker(sb.fetch),
    spawnFn: claude.spawnFn,
    now: NOW,
    print: (l: string) => void lines.push(l),
  };
  return { sb, claude, lines, deps };
}

test("a due Scout team topic is researched locally and published like any run", async () => {
  const s = setup({ runnerOn: true });
  const code = await teamRunMain(
    [],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    s.deps,
  );

  assert.equal(code, 0);
  assert.equal(s.sb.finished.length, 1);
  const [done] = s.sb.finished;
  assert.deepEqual(done.p_coverage, {
    topic: "LLM releases, prices and retirements",
    status: "covered",
  });
  // The section is the topic's own, its preamble gone, as the Worker stores it.
  assert.match(
    done.p_section_md as string,
    /^## LLM releases, prices and retirements\n- `2026-11-19` — \*\*A vendor retired a model/,
  );
  assert.equal(done.p_error, null);
  // The paused topic never ran.
  assert.equal(s.claude.spawns.length, 1);
  assert.ok(!s.sb.calls.includes("team_start_run"));
});

test("a team run sends what its claude session used with the result", async () => {
  const s = setup({ runnerOn: true, json: true });
  const code = await teamRunMain(
    [],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    s.deps,
  );

  assert.equal(code, 0);
  const [done] = s.sb.finished;
  assert.equal((done.p_coverage as { status: string }).status, "covered");
  assert.deepEqual(done.p_usage, {
    model: "claude-haiku-5-5",
    stopReason: "end_turn",
    turns: 5,
    inputTokens: 800,
    outputTokens: 700,
    cacheReadTokens: 20_000,
    cacheWriteTokens: 2_000,
    webSearches: 3,
    webFetches: null,
    costUsd: 0.031,
  });
});

test("a team session is capped: the search budget in the prompt and --max-turns", async () => {
  const s = setup({ runnerOn: true });
  await teamRunMain([], { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps);
  const [{ args, prompt }] = s.claude.spawns;
  assert.deepEqual(
    args.slice(args.indexOf("--max-turns"), args.indexOf("--max-turns") + 2),
    ["--max-turns", "6"],
  );
  // The doc names no sources (runLimits): 2 searches and 2 fetches, under
  // the plan's 5.
  assert.match(
    prompt,
    /Use WebSearch at most 2 times and WebFetch at most 2 times\./,
  );
  assert.ok(args.includes("WebSearch,WebFetch"));
});

test("a team run's prompt carries its brief settings, cadence and what was already posted", async () => {
  for (const argv of [[], ["--only", "Emulator releases"]]) {
    const s = setup({ runnerOn: true, facts: true });
    assert.equal(
      await teamRunMain(argv, { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps),
      0,
    );
    const [{ prompt }] = s.claude.spawns;
    assert.match(prompt, /Cadence: daily\./);
    assert.match(prompt, /Last posted story: 2026-11-18 \(2 days ago\)\./);
    assert.match(prompt, /Stories already posted \(newest brief first\):/);
    assert.match(prompt, /The old story — https:\/\/example\.com\/old-story/);
    assert.match(prompt, /Search in Norwegian Bokmål \(Norway\)/);
    assert.match(prompt, /marked evergreen/);
    assert.match(prompt, /0-2 story bullets/);
  }
});

test("a make topic is written with no web tools, its memory in the prompt", async () => {
  const s = setup({ runnerOn: true, make: true });
  assert.equal(
    await teamRunMain([], { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps),
    0,
  );
  const [{ args, prompt }] = s.claude.spawns;
  assert.deepEqual(
    args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2),
    ["--tools", ""],
  );
  assert.ok(!args.includes("WebSearch,WebFetch"));
  assert.match(prompt, /Already sent \(never repeat these\):\n- koselig/);
  const [done] = s.sb.finished;
  assert.equal((done.p_coverage as { status: string }).status, "covered");
  assert.match(done.p_section_md as string, /— dugnad/);
});

test("the runner refuses to start without SCOUT_TEAM_RUNNER=on", async () => {
  const s = setup({ runnerOn: true });
  for (const env of [{}, { SCOUT_TEAM_RUNNER: "1" }]) {
    assert.equal(await teamRunMain([], env, CONFIG, s.deps), 1);
    assert.equal(
      await teamRunMain(["--only", "Emulator releases"], env, CONFIG, s.deps),
      1,
    );
  }
  assert.deepEqual(s.sb.calls, []);
  assert.equal(s.claude.spawns.length, 0);
  assert.match(s.lines[0], /off/);
});

test("--only runs one paused topic once and leaves the schedule alone", async () => {
  const s = setup({ runnerOn: true });
  const code = await teamRunMain(
    ["--only", "emulator releases"],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    s.deps,
  );
  assert.equal(code, 0);
  assert.deepEqual(s.sb.calls, [
    "team_topics",
    "team_start_run",
    "team_finish_run",
  ]);
  assert.equal(
    (s.sb.finished[0].p_coverage as { topic: string }).topic,
    "Emulator releases",
  );
});

test("--dry-run researches and prints what it would publish, and publishes nothing", async () => {
  const s = setup({ runnerOn: true });
  const code = await teamRunMain(["--dry-run"], {}, CONFIG, s.deps);
  assert.equal(code, 0);
  assert.deepEqual(s.sb.calls, ["team_topics"]);
  assert.equal(s.sb.finished.length, 0);
  const out = s.lines.join("\n");
  assert.match(
    out,
    /would publish "LLM releases, prices and retirements": covered/,
  );
  assert.match(out, /^## LLM releases, prices and retirements$/m);

  const one = setup();
  assert.equal(
    await teamRunMain(["--dry-run", "--only", PAUSED], {}, CONFIG, one.deps),
    0,
  );
  assert.match(one.lines.join("\n"), /would publish "Emulator releases"/);
  assert.deepEqual(one.sb.calls, ["team_topics"]);
});

test("a failed session is published as a failed attempt", async () => {
  const s = setup({ runnerOn: true, fail: true });
  const code = await teamRunMain(
    [],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    s.deps,
  );
  assert.equal(code, 1);
  assert.equal(s.sb.finished[0].p_section_md, null);
  assert.match(s.sb.finished[0].p_error as string, /hit your limit/);
});

test("with the database switch off, the runner says so and runs nothing", async () => {
  const s = setup({ runnerOn: false });
  assert.equal(
    await teamRunMain(
      ["--only", "Emulator releases"],
      { SCOUT_TEAM_RUNNER: "on" },
      CONFIG,
      s.deps,
    ),
    1,
  );
  assert.match(s.lines.join("\n"), /team_runner_on/);
  assert.match(s.lines.join("\n"), /team_catalog_on/);
  assert.equal(s.claude.spawns.length, 0);

  assert.equal(
    await teamRunMain([], { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps),
    0,
  );
  assert.match(s.lines.join("\n"), /Nothing was due/);
});

test("the token is sent to the Worker and never printed", async () => {
  const s = setup({ runnerOn: true });
  await teamRunMain(["--list"], {}, CONFIG, s.deps);
  await teamRunMain([], { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps);
  assert.ok(s.lines.length > 0);
  assert.ok(s.lines.every((l) => !l.includes(TOKEN)));

  const wrong = setup({ runnerOn: true });
  assert.equal(
    await teamRunMain(
      ["--list"],
      {},
      { ...CONFIG, TEAM_RUNNER_TOKEN: "wrong" },
      wrong.deps,
    ),
    1,
  );
  assert.deepEqual(wrong.sb.calls, []);
});

test("missing config or a bad flag stops before anything runs", async () => {
  const s = setup({ runnerOn: true });
  assert.equal(
    await teamRunMain([], { SCOUT_TEAM_RUNNER: "on" }, {}, s.deps),
    1,
  );
  assert.equal(await teamRunMain(["--everything"], {}, CONFIG, s.deps), 2);
  assert.equal(await teamRunMain(["--only"], {}, CONFIG, s.deps), 2);
  assert.deepEqual(s.sb.calls, []);
});

test("--loop runs a pass, waits a minute, runs again, and exits 0 once stopped", async () => {
  const s = setup({ runnerOn: true });
  const stop = new AbortController();
  const waits: number[] = [];
  const code = await teamRunMain(
    ["--loop"],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    {
      ...s.deps,
      signal: stop.signal,
      sleep: async (ms) => {
        waits.push(ms);
        // A Run now arrives while the runner waits; SIGTERM after the next pass.
        if (waits.length === 1) s.sb.topics[1].due = true;
        else stop.abort();
      },
    },
  );
  assert.equal(code, 0);
  assert.deepEqual(waits, [60_000, 60_000]);
  assert.deepEqual(
    s.sb.finished.map((f) => (f.p_coverage as { topic: string }).topic),
    ["LLM releases, prices and retirements", "Emulator releases"],
  );
  assert.match(s.lines.join("\n"), /stopped\./);
});

test("--loop carries on after a failed pass", async () => {
  const s = setup({ runnerOn: true });
  const stop = new AbortController();
  let calls = 0;
  const flaky = (async (url: string, init: RequestInit) => {
    if (++calls === 1) throw new Error("the Worker is unreachable");
    return s.deps.fetch(url, init);
  }) as unknown as typeof globalThis.fetch;
  const code = await teamRunMain(
    ["--loop"],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    {
      ...s.deps,
      fetch: flaky,
      signal: stop.signal,
      sleep: async () => {
        if (s.sb.finished.length) stop.abort();
      },
    },
  );
  assert.equal(code, 0);
  assert.match(s.lines.join("\n"), /unreachable/);
  assert.equal(s.sb.finished.length, 1);
});

test("SIGTERM during a run lets it publish and claims nothing more", async () => {
  const s = setup({ runnerOn: true });
  s.sb.topics[1].due = true;
  const stop = new AbortController();
  const code = await teamRunMain(
    ["--loop"],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    {
      ...s.deps,
      signal: stop.signal,
      print: (l) => {
        s.lines.push(l);
        if (l.startsWith("researching")) stop.abort();
      },
      sleep: async () => assert.fail("no wait after a stop"),
    },
  );
  assert.equal(code, 0);
  assert.equal(s.sb.finished.length, 1);
  assert.equal(s.sb.calls.filter((c) => c === "team_claim_runs").length, 1);
});

test("--loop refuses to mix with --dry-run, --list or --only", async () => {
  const s = setup({ runnerOn: true });
  for (const argv of [
    ["--loop", "--dry-run"],
    ["--loop", "--list"],
    ["--loop", "--only", "Emulator releases"],
  ])
    assert.equal(
      await teamRunMain(argv, { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps),
      2,
    );
  assert.deepEqual(s.sb.calls, []);
});

// The Worker's picks routes as a stub: two local readers due picks.
function picksWorker() {
  const finished: unknown[] = [];
  const auth: string[] = [];
  const request = {
    model: "claude-haiku-5-5",
    max_tokens: 800,
    messages: [{ role: "user", content: [{ type: "text", text: "Pick." }] }],
    output_config: {
      format: { type: "json_schema", schema: { type: "object" } },
    },
  };
  const fetch = (async (url: string, init: RequestInit) => {
    auth.push((init.headers as Record<string, string>).authorization);
    const path = url.replace(WORKER, "");
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    if (path === "/team/claim") return ok({ runs: [] });
    if (path === "/team/picks/claim")
      return ok({
        prompts: [
          { turnId: "picks-1", request },
          { turnId: "picks-2", request },
        ],
      });
    if (path === "/team/picks/finish") {
      finished.push(JSON.parse(init.body as string));
      return ok({ stored: true });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, finished, auth };
}

test("--loop answers local readers' picks with the local claude", async () => {
  const w = picksWorker();
  const claude = stubClaude({ json: true });
  const lines: string[] = [];
  const stop = new AbortController();
  const code = await teamRunMain(
    ["--loop"],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    {
      fetch: w.fetch,
      spawnFn: claude.spawnFn,
      print: (l) => void lines.push(l),
      signal: stop.signal,
      sleep: async () => stop.abort(),
    },
  );
  assert.equal(code, 0);
  assert.deepEqual(
    w.finished.map((f) => (f as { turnId: string }).turnId),
    ["picks-1", "picks-2"],
  );
  const [first] = w.finished as Array<{
    text: string;
    usage: Record<string, number>;
  }>;
  assert.match(first.text, /^I have enough/);
  assert.equal(first.usage.outputTokens, 700);
  const args = claude.spawns[0].args;
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.ok(args.includes("--json-schema"));
  assert.ok(w.auth.every((a) => a === `Bearer ${TOKEN}`));
  assert.match(lines.join("\n"), /picks: 2 of 2 stored/);
  assert.doesNotMatch(lines.join("\n"), new RegExp(TOKEN));
});

test("a pick claude can't answer is printed and left; the loop goes on", async () => {
  const w = picksWorker();
  const lines: string[] = [];
  const stop = new AbortController();
  const code = await teamRunMain(
    ["--loop"],
    { SCOUT_TEAM_RUNNER: "on" },
    CONFIG,
    {
      fetch: w.fetch,
      spawnFn: stubClaude({ fail: true }).spawnFn,
      print: (l) => void lines.push(l),
      signal: stop.signal,
      sleep: async () => stop.abort(),
    },
  );
  assert.equal(code, 0);
  assert.equal(w.finished.length, 0);
  assert.match(lines.join("\n"), /picks picks-1: claude exited 1/);
  assert.match(lines.join("\n"), /picks: 0 of 2 stored/);
});
