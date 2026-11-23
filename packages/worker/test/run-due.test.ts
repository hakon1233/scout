// runDue through its interface, with a stub queue and recorded Claude
// responses. No network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BRIEF_SETTINGS } from "@scout/core";
import { recordedClient, type MessagesResponse } from "@scout/research";
import {
  MAX_BATCH,
  notifyBudget,
  picksBatch,
  runDue,
  type ClaimedRun,
  type RunOutcome,
  type RunQueue,
} from "../src/run-due.ts";

const today = new Date().toISOString().slice(0, 10);

function answer(topic: string): MessagesResponse {
  return {
    content: [
      {
        type: "text",
        text: `## ${topic}\n\n- \`${today}\` — Something happened.\n  [example.org — Story](https://example.org/1)\n  > Lead.\n`,
      },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10_000,
      output_tokens: 1_000,
      server_tool_use: { web_search_requests: 2 },
    },
  };
}

function stubQueue(
  runs: ClaimedRun[],
  opts: { failFinish?: string } = {},
): RunQueue & {
  limits: number[];
  finished: Array<[string, RunOutcome]>;
} {
  const limits: number[] = [];
  const finished: Array<[string, RunOutcome]> = [];
  return {
    limits,
    finished,
    async claim(limit) {
      limits.push(limit);
      return runs.slice(0, limit);
    },
    async finish(runId, outcome) {
      if (runId === opts.failFinish) throw new Error("network down");
      finished.push([runId, outcome]);
    },
  };
}

const run = (n: number): ClaimedRun => ({
  runId: `run-${n}`,
  topic: `Topic ${n}`,
  doc: "",
  searchesPerRun: 3,
  settings: DEFAULT_BRIEF_SETTINGS,
  prior: [],
  cadence: "daily",
  lastStoryAt: null,
  mode: "news",
  sentKeys: [],
});

test("a tick researches each claimed run and records its section and cost", async () => {
  const queue = stubQueue([run(1)]);
  const claude = recordedClient([answer("Topic 1")]);

  const summary = await runDue({ queue, claude, batchSize: 2 });

  assert.deepEqual(summary, { claimed: 1, ready: 1, failed: 0, unrecorded: 0 });
  assert.deepEqual(queue.limits, [2]);
  const [[runId, outcome]] = queue.finished;
  assert.equal(runId, "run-1");
  assert.match(outcome.sectionMd ?? "", /^## Topic 1\n/);
  assert.deepEqual(outcome.coverage, { topic: "Topic 1", status: "covered" });
  assert.equal(outcome.searches, 2);
  assert.ok(outcome.costUsd > 0.02, "the searches are priced in");
  assert.equal(outcome.error, undefined);
  // The plan's searches_per_run caps the search tool.
  const search = claude.requests[0].tools?.find((t) => t.name === "web_search");
  assert.equal(search?.max_uses, 3);
});

test("a make run writes its piece with no web tools, its memory in the prompt", async () => {
  const make: ClaimedRun = {
    ...run(1),
    topic: "Word of the day",
    mode: "make",
    sentKeys: ["koselig"],
  };
  const queue = stubQueue([make]);
  const claude = recordedClient([
    {
      content: [
        {
          type: "text",
          text: `## Word of the day\n\n- \`${today}\` — dugnad\n  > Work done together, unpaid, for the common good.\n`,
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 800, output_tokens: 200 },
    },
  ]);

  const summary = await runDue({ queue, claude });

  assert.deepEqual(summary, { claimed: 1, ready: 1, failed: 0, unrecorded: 0 });
  assert.equal(claude.requests[0].tools, undefined);
  assert.match(
    String(claude.requests[0].messages[0].content[0].text),
    /- koselig/,
  );
  const [[, outcome]] = queue.finished;
  assert.deepEqual(outcome.coverage, {
    topic: "Word of the day",
    status: "covered",
  });
  assert.equal(outcome.searches, 0);
  assert.ok(outcome.costUsd > 0 && outcome.costUsd < 0.01, "no search fee");
});

test("a run records the token usage of all its Claude calls, summed", async () => {
  const queue = stubQueue([run(1)]);
  const paused: MessagesResponse = {
    content: [{ type: "text", text: "Searching…" }],
    stop_reason: "pause_turn",
    usage: {
      input_tokens: 4_000,
      output_tokens: 200,
      cache_read_input_tokens: 3_000,
      cache_creation_input_tokens: 500,
    },
  };
  const done: MessagesResponse = {
    ...answer("Topic 1"),
    usage: {
      input_tokens: 6_000,
      output_tokens: 800,
      cache_read_input_tokens: 1_000,
    },
  };
  const claude = recordedClient([paused, done]);

  await runDue({ queue, claude });

  const [[, outcome]] = queue.finished;
  assert.equal(claude.requests.length, 2);
  assert.deepEqual(
    [
      outcome.inputTokens,
      outcome.outputTokens,
      outcome.cacheReadTokens,
      outcome.cacheWriteTokens,
    ],
    [10_000, 1_000, 4_000, 500],
  );
});

test("a run records its fetches, model, stop reason, requests and largest prompt", async () => {
  const queue = stubQueue([run(1)]);
  const paused: MessagesResponse = {
    model: "claude-haiku-5-5-20261101",
    content: [{ type: "text", text: "Searching…" }],
    stop_reason: "pause_turn",
    usage: {
      input_tokens: 2_000,
      output_tokens: 200,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 1_000,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
    },
  };
  const done: MessagesResponse = {
    ...answer("Topic 1"),
    model: "claude-haiku-5-5-20261101",
    usage: {
      input_tokens: 9_000,
      output_tokens: 800,
      cache_read_input_tokens: 95_000,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 },
    },
  };
  const claude = recordedClient([paused, done]);

  await runDue({ queue, claude });

  const [[, outcome]] = queue.finished;
  assert.equal(outcome.searches, 2);
  assert.equal(outcome.webFetches, 3);
  assert.equal(outcome.model, "claude-haiku-5-5-20261101");
  assert.equal(outcome.stopReason, "end_turn");
  assert.equal(outcome.requests, 2);
  // The second request's prompt: 9,000 + 95,000 cache reads.
  assert.equal(outcome.maxPromptTokens, 104_000);
  assert.equal(outcome.longContext, true, "one request crossed 100K");
});

test("a run under the long-prompt line is not long-context, and a failed one has no stop reason", async () => {
  const ok = stubQueue([run(1)]);
  await runDue({ queue: ok, claude: recordedClient([answer("Topic 1")]) });
  const [[, short]] = ok.finished;
  assert.equal(short.maxPromptTokens, 10_000);
  assert.equal(short.longContext, false);
  assert.equal(short.webFetches, 0);
  assert.equal(short.requests, 1);
  assert.equal(
    short.model,
    "claude-haiku-5-5",
    "the model asked for, when the response names none",
  );

  const broken = stubQueue([run(2)]);
  await runDue({ queue: broken, claude: recordedClient([]) });
  const [[, failed]] = broken.finished;
  assert.equal(failed.stopReason, null);
  assert.equal(failed.requests, 0);
  assert.equal(failed.maxPromptTokens, 0);
  assert.equal(failed.longContext, false);
});

test("a failed research is recorded as a failed attempt with its cost", async () => {
  const queue = stubQueue([run(1)]);
  const claude = recordedClient([]); // the first call throws

  const summary = await runDue({ queue, claude });

  assert.deepEqual(summary, { claimed: 1, ready: 0, failed: 1, unrecorded: 0 });
  const [[, outcome]] = queue.finished;
  assert.equal(outcome.sectionMd, null);
  assert.equal(outcome.coverage.status, "missing");
  assert.match(outcome.error ?? "", /no recorded response/);
  assert.equal(outcome.retry, true, "a broken connection may run once more");
});

test("a run's settings and earlier sections reach the research prompt", async () => {
  const queue = stubQueue([
    {
      ...run(1),
      settings: { ...DEFAULT_BRIEF_SETTINGS, stories: 2 },
      prior: [
        {
          date: "2026-11-19T07:00:00Z",
          markdown:
            "## Topic 1\n- `2026-11-18` — Old.\n  [example.org — Old story](https://example.org/old)\n",
        },
      ],
    },
  ]);
  const claude = recordedClient([answer("Topic 1")]);
  await runDue({ queue, claude });
  const prompt = JSON.stringify(claude.requests[0].messages[0].content);
  assert.match(prompt, /0-2 story bullets/);
  assert.match(prompt, /Stories already posted/);
  assert.match(prompt, /Old story/);
  assert.match(prompt, /Cadence: daily/);
  assert.equal(
    queue.finished[0][1].retry,
    undefined,
    "a ready run has no retry flag",
  );
});

test("a result the queue cannot record leaves that run for the reaper, not the others", async () => {
  const queue = stubQueue([run(1), run(2)], { failFinish: "run-1" });
  const claude = recordedClient([answer("Topic 1"), answer("Topic 2")]);

  const summary = await runDue({ queue, claude, batchSize: 2 });

  assert.equal(summary.unrecorded, 1);
  assert.deepEqual(
    queue.finished.map(([id]) => id),
    ["run-2"],
  );
});

test("the batch stays within the free plan's 50 subrequests", async () => {
  const queue = stubQueue([]);
  const claude = recordedClient([]);

  await runDue({ queue, claude, batchSize: 100 });
  await runDue({ queue, claude, batchSize: Number("garbled") });
  await runDue({ queue, claude });

  assert.equal(MAX_BATCH, 9);
  assert.deepEqual(queue.limits, [9, 2, 2]);
  // Picks get up to 3 readers (2 each, plus a claim) of what the runs leave;
  // pushes get the rest.
  assert.equal(picksBatch(2), 3);
  assert.equal(picksBatch(100), 1);
  assert.equal(picksBatch(Number("garbled")), 3);
  assert.equal(notifyBudget(2), 32);
  assert.equal(notifyBudget(100), 1);
  assert.equal(notifyBudget(Number("garbled")), 32);
  // Every tick fits the 50: claim + runs + picks claim + picks + pushes.
  for (const b of [0, 1, 2, 5, 9, 100]) {
    const runs = Math.min(9, b) * 5;
    const picks = picksBatch(b);
    assert.ok(1 + runs + (picks ? 1 + picks * 2 : 0) + notifyBudget(b) <= 50);
  }
});

test("a batch of 0 claims nothing", async () => {
  const queue = stubQueue([run(1)]);
  const summary = await runDue({
    queue,
    claude: recordedClient([]),
    batchSize: 0,
  });
  assert.equal(summary.claimed, 0);
  assert.deepEqual(queue.limits, []);
});

test("a failed claim fails the tick", async () => {
  const queue: RunQueue = {
    claim: async () => {
      throw new Error("claim_runs: 503");
    },
    finish: async () => {},
  };
  await assert.rejects(runDue({ queue, claude: recordedClient([]) }), /503/);
});
