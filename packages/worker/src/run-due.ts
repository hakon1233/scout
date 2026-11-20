// One tick of the run queue: claim a small batch of due runs, research each
// one, record each result and its cost. Host-neutral: the queue and Claude are
// injected, so the Cloudflare Worker is only wiring and tests use stubs.
//
// Due times, the global ceiling, the kill switch, single flight, retries and
// the stale-run reaper all live in SQL (claim_runs, finish_run); this module
// never decides whether a run may start.

import type { BriefSettings, PriorBrief } from "@scout/core";
import {
  researchInterest,
  type ClaudeClient,
  type ResearchResult,
} from "@scout/research";

export type ClaimedRun = {
  runId: string;
  topic: string;
  doc: string;
  searchesPerRun: number;
  settings: BriefSettings;
  // The interest's last ready sections, newest first: "already reported".
  prior: PriorBrief[];
  cadence: "daily" | "weekly" | null;
  // When the interest last had a story (ISO); null: never.
  lastStoryAt: string | null;
};

export type RunOutcome = {
  sectionMd: string | null; // null: the attempt failed
  coverage: ResearchResult["coverage"];
  searches: number;
  costUsd: number;
  error?: string;
  // A failed attempt only: false when another attempt cannot help (a 4xx,
  // a rate or spend limit, a timeout), so the run fails at once.
  retry?: boolean;
};

// The queue seam. Adapters: supabaseQueue (PostgREST over fetch) and the test
// stub in test/run-due.test.ts.
export interface RunQueue {
  // Claims up to `limit` due runs and marks them running. Returns none while
  // the kill switch is on or today's spend is at the ceiling.
  claim(limit: number): Promise<ClaimedRun[]>;
  // Records a claimed run's outcome. A failed first attempt is queued again
  // unless its outcome says retry: false.
  finish(runId: string, outcome: RunOutcome): Promise<void>;
}

// Workers free plan: 50 subrequests per invocation. A tick makes one for the
// claim, and each run at most 4 Claude requests (1 + 3 pause_turn
// continuations) plus 1 finish.
export const SUBREQUEST_LIMIT = 50;
export const SUBREQUESTS_PER_RUN = 5;
export const MAX_BATCH = Math.floor(
  (SUBREQUEST_LIMIT - 1) / SUBREQUESTS_PER_RUN,
); // 9
// The 10 ms CPU limit, not subrequests, is the tighter bound: each run parses
// and re-sends Claude's whole turn (search results included) as JSON.
export const DEFAULT_BATCH = 2;

// A missing or garbled batch size (an unset RUN_BATCH) means the default.
function batchLimit(batchSize: number | undefined): number {
  const size = Number.isFinite(batchSize)
    ? Math.floor(batchSize as number)
    : DEFAULT_BATCH;
  return Math.max(0, Math.min(MAX_BATCH, size));
}

/** The subrequests a tick's outbox drain may use: what the claim and the runs leave. */
export function notifyBudget(batchSize: number | undefined): number {
  return SUBREQUEST_LIMIT - 1 - batchLimit(batchSize) * SUBREQUESTS_PER_RUN;
}

export type RunDueDeps = {
  queue: RunQueue;
  claude: ClaudeClient;
  batchSize?: number;
  timeoutMs?: number; // per run; researchInterest's own default is 300 s
};

export type TickSummary = {
  claimed: number;
  ready: number;
  failed: number;
  // Outcomes the queue did not accept; the reaper retries those runs.
  unrecorded: number;
};

// Throws only when the claim fails. A run whose result cannot be recorded is
// left running for the reaper; the other runs carry on.
export async function runDue(deps: RunDueDeps): Promise<TickSummary> {
  const limit = batchLimit(deps.batchSize);
  const runs = limit ? await deps.queue.claim(limit) : [];
  const summary: TickSummary = {
    claimed: runs.length,
    ready: 0,
    failed: 0,
    unrecorded: 0,
  };

  await Promise.all(
    runs.map(async (run) => {
      const result = await researchInterest(
        {
          topic: run.topic,
          doc: run.doc,
          settings: run.settings,
          prior: run.prior,
          cadence: run.cadence,
          lastPosted: run.lastStoryAt,
        },
        {
          claude: deps.claude,
          maxSearches: run.searchesPerRun,
          timeoutMs: deps.timeoutMs,
        },
      );
      const outcome: RunOutcome = {
        sectionMd: result.sectionMd,
        coverage: result.coverage,
        searches: result.usage.webSearches,
        costUsd: result.usage.costUsd,
        ...(result.error ? { error: result.error } : {}),
        ...(result.sectionMd === null
          ? { retry: result.retryable ?? true }
          : {}),
      };
      try {
        // finish_run also queues the "brief is ready" pushes (push.ts sends them).
        await deps.queue.finish(run.runId, outcome);
        if (outcome.sectionMd === null) summary.failed++;
        else summary.ready++;
      } catch {
        summary.unrecorded++;
      }
    }),
  );
  return summary;
}
