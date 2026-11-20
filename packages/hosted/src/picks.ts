// Picks: one cached ranking per reader. The store claims the readers due a
// refresh (it owns the weekly and profile-change triggers, the 24-hour
// debounce and the spend caps) with each one's input; this module makes one
// Haiku call per reader and hands the picks back. Host-neutral: the Worker's
// cron wires it to Supabase.

import {
  PICKS_SCHEMA,
  buildPicksPrompt,
  parsePicks,
  type Pick,
  type PicksInput,
  HAIKU_MODEL,
} from "@scout/core";
import { responseCostUsd, type ClaudeClient } from "@scout/research";

export const PICKS_MODEL = HAIKU_MODEL;
const MAX_OUTPUT_TOKENS = 1024;
const PICKS_TIMEOUT_MS = 30_000;

export type PicksJob = {
  userId: string;
  runId: number;
  // weekly: the Monday refresh; profile: a profile change; stale: the cached
  // picks were made by an older PICKS_VERSION.
  kind: "weekly" | "profile" | "stale";
  input: PicksInput;
};

export type PicksStore = {
  // Claims up to `limit` readers due a refresh. Readers over their spend cap,
  // or all of them while global spending is closed, are never returned.
  claim(limit: number): Promise<PicksJob[]>;
  // Records the call. picks null keeps the cached picks (the call failed).
  finish(
    job: PicksJob,
    picks: Pick[] | null,
    costUsd: number,
    error: string | null,
  ): Promise<void>;
};

export type PicksResult = {
  claimed: number;
  stored: number;
  failed: number;
  costUsd: number;
};

export function createPicks(deps: { claude: ClaudeClient; store: PicksStore }) {
  const { claude, store } = deps;

  async function pick(input: PicksInput) {
    const response = await claude.createMessage(
      {
        model: PICKS_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: PICKS_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: buildPicksPrompt(input) }],
          },
        ],
      },
      AbortSignal.timeout(PICKS_TIMEOUT_MS),
    );
    const text =
      response.stop_reason !== "refusal" &&
      response.stop_reason !== "max_tokens"
        ? response.content
            .flatMap((b) =>
              b.type === "text" && typeof b.text === "string" ? [b.text] : [],
            )
            .join("")
        : "";
    return {
      picks: parsePicks(text, input.candidates, input),
      costUsd: responseCostUsd(response.usage),
    };
  }

  async function one(job: PicksJob, result: PicksResult) {
    // No candidates: nothing to ask, and nothing to pay for.
    if (job.input.candidates.length === 0) {
      await store.finish(job, [], 0, null);
      result.stored++;
      return;
    }
    let picks: Pick[];
    let costUsd: number;
    try {
      ({ picks, costUsd } = await pick(job.input));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[picks] call failed:", message);
      await store.finish(job, null, 0, message.slice(0, 500));
      result.failed++;
      return;
    }
    await store.finish(job, picks, costUsd, null);
    result.stored++;
    result.costUsd += costUsd;
  }

  return {
    /** Refreshes up to `limit` readers' picks. */
    async refresh(limit: number): Promise<PicksResult> {
      const result: PicksResult = {
        claimed: 0,
        stored: 0,
        failed: 0,
        costUsd: 0,
      };
      if (limit <= 0) return result;
      const jobs = await store.claim(limit);
      result.claimed = jobs.length;
      await Promise.all(jobs.map((job) => one(job, result)));
      return result;
    },
  };
}
