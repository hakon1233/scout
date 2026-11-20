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
function fakeSupabase(opts: { runnerOn?: boolean } = {}) {
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
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, finished, topics };
}

// The Worker, in process, as the runner's fetch.
function worker(supabase: typeof globalThis.fetch, notified: string[]) {
  return (async (url: string, init: RequestInit) =>
    handleRequest(new Request(url, init), {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: "https://app.example.test",
      serviceKey: "service-key",
      teamToken: TOKEN,
      notify: async (runId) => void notified.push(runId),
      fetch: supabase,
    })) as unknown as typeof globalThis.fetch;
}

// A `claude` stand-in that writes a dated story under the prompt's topic.
function stubClaude(reply: { fail?: boolean } = {}) {
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
      const topic = /single topic: "([^"]+)"/.exec(prompt)?.[1] ?? "?";
      setImmediate(() => {
        if (reply.fail) {
          child.stderr.emit("data", Buffer.from("You've hit your limit"));
          child.emit("close", 1);
          return;
        }
        child.stdout.emit(
          "data",
          Buffer.from(
            `I have enough.\n\n## ${topic}\n` +
              "- `2026-11-19` — **A vendor retired a model.** It goes on 1 December.\n" +
              "  [example.com — Retirement notice](https://example.com/notice)\n",
          ),
        );
        child.emit("close", 0);
      });
    });
    return child;
  }) as unknown as typeof spawn;
  return { spawnFn, spawns };
}

function setup(opts: { runnerOn?: boolean; fail?: boolean } = {}) {
  const sb = fakeSupabase(opts);
  const notified: string[] = [];
  const claude = stubClaude(opts);
  const lines: string[] = [];
  const deps = {
    fetch: worker(sb.fetch, notified),
    spawnFn: claude.spawnFn,
    now: NOW,
    print: (l: string) => void lines.push(l),
  };
  return { sb, notified, claude, lines, deps };
}

test("a due Scout team topic is researched locally and published like any run, push included", async () => {
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
  assert.deepEqual(s.notified, [done.p_run]);
  // The paused topic never ran.
  assert.equal(s.claude.spawns.length, 1);
  assert.ok(!s.sb.calls.includes("team_start_run"));
});

test("a team session is capped: the search budget in the prompt and --max-turns", async () => {
  const s = setup({ runnerOn: true });
  await teamRunMain([], { SCOUT_TEAM_RUNNER: "on" }, CONFIG, s.deps);
  const [{ args, prompt }] = s.claude.spawns;
  assert.deepEqual(
    args.slice(args.indexOf("--max-turns"), args.indexOf("--max-turns") + 2),
    ["--max-turns", "12"],
  );
  assert.match(
    prompt,
    /Use WebSearch at most 5 times and WebFetch at most 5 times\./,
  );
  assert.ok(args.includes("WebSearch,WebFetch"));
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
  assert.equal(s.notified.length, 1);
});

test("--dry-run researches and prints what it would publish, and publishes nothing", async () => {
  const s = setup({ runnerOn: true });
  const code = await teamRunMain(["--dry-run"], {}, CONFIG, s.deps);
  assert.equal(code, 0);
  assert.deepEqual(s.sb.calls, ["team_topics"]);
  assert.equal(s.sb.finished.length, 0);
  assert.deepEqual(s.notified, []);
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

test("a failed session is published as a failed attempt, with no push", async () => {
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
  assert.deepEqual(s.notified, []);
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
