// runDue through its interface, with a stub queue and recorded Claude
// responses. No network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { recordedClient, type MessagesResponse } from "@scout/research";
import {
  MAX_BATCH,
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

test("a failed research is recorded as a failed attempt with its cost", async () => {
  const queue = stubQueue([run(1)]);
  const claude = recordedClient([]); // the first call throws

  const summary = await runDue({ queue, claude });

  assert.deepEqual(summary, { claimed: 1, ready: 0, failed: 1, unrecorded: 0 });
  const [[, outcome]] = queue.finished;
  assert.equal(outcome.sectionMd, null);
  assert.equal(outcome.coverage.status, "missing");
  assert.match(outcome.error ?? "", /no recorded response/);
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
