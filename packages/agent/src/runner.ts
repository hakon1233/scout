// Shared brief-run path used by BOTH the on-demand HTTP endpoint
// (POST /v0/interests) and the in-process scheduler (PER-151). Centralizing it
// here means the schedule does not fork the run logic — it kicks the exact same
// synthesis the "Run now" button does.
//
// Concurrency safety (PER-151 requirement): we must NEVER launch overlapping
// runs. The companion holds exactly one brief slot (last_brief, last-writer-
// wins). Two guards enforce single-flight:
//   1. An in-memory `runInFlight` boolean, shared across the HTTP server and the
//      scheduler because both import this module (one process, one singleton).
//      This closes the loadState→saveState async gap where the persisted
//      `pending` flag isn't visible yet.
//   2. The persisted `last_brief.status === "pending"` check, which survives a
//      restart mid-run.
// A run that can't start returns {started:false} with a reason; callers decide
// whether to 409 (HTTP) or record a "skipped" schedule entry.

import { spawn } from "node:child_process";
import {
  loadState,
  newBriefId,
  saveState,
  interestTopics,
  type Brief,
  type Interest,
  type ScheduleConfig,
} from "./state.js";
import { researchAndSynthesize } from "./research.js";
import { computeCoverage, mergeBriefSections } from "./coverage.js";

export type RunDeps = {
  stateFile: string;
  claudeBin?: string;
  // Spawn override for tests; production uses node:child_process spawn.
  spawnFn?: typeof spawn;
  // Fired when synthesis finishes (ready or failed). Tests await this.
  onSynthesisDone?: (brief: Brief) => void;
};

export type RunSource = "on_demand" | "scheduled";

export type RunOptions = {
  // Focused-retry path (PER-154): research ONLY this subset of `interests`
  // instead of the whole list, then merge the fresh sections into the prior
  // brief's markdown (preserving the topics that already worked) before
  // recomputing coverage over the full interest list. Must be a subset of
  // `interests`. When absent/empty, a normal full-brief run happens.
  retryTopics?: string[];
};

export type RunOutcome =
  | { started: true; briefId: string }
  | { started: false; reason: "in_flight"; briefId?: string }
  | { started: false; reason: "no_interests" }
  | { started: false; reason: "no_base_brief" };

// Single-process, single-flight guard (see header).
let runInFlight = false;

export function isRunInFlight(): boolean {
  return runInFlight;
}

// Begin a synthesis run for `interests`. Persists the interests (so the
// scheduler can reuse them) and a pending brief, then fires synthesis fire-and-
// forget — callers poll GET /v0/briefs to see it land. Returns immediately with
// the outcome. `source` only affects whether the eventual result is recorded
// into the schedule's last-run telemetry.
export async function startRun(
  interests: Interest[],
  deps: RunDeps,
  source: RunSource = "on_demand",
  opts: RunOptions = {},
): Promise<RunOutcome> {
  const state = await loadState(deps.stateFile);

  if (runInFlight || state.last_brief?.status === "pending") {
    return { started: false, reason: "in_flight", briefId: state.last_brief?.id };
  }
  if (interests.length === 0) {
    return { started: false, reason: "no_interests" };
  }

  // The engine is topic-only (per-interest doc injection is C2/PER-171). Convert
  // the rich interests to their topic strings at this single boundary; the rich
  // {id, topic} objects are what we persist below.
  const topics = interestTopics(interests);

  // A focused retry only makes sense when there's a prior ready brief to merge
  // the fresh sections into; without one there's nothing to preserve, so the
  // caller should run a full brief instead. We narrow to the retry topics that
  // are actually part of the current interest list (ignore stale/foreign ones).
  const baseMarkdown = state.last_brief?.summary_md;
  const retryTopics = (opts.retryTopics ?? []).filter((t) => topics.includes(t));
  const isRetry = retryTopics.length > 0;
  if (isRetry && !baseMarkdown) {
    return { started: false, reason: "no_base_brief" };
  }

  runInFlight = true;
  const briefId = newBriefId();
  const pending: Brief = {
    id: briefId,
    generated_at: new Date().toISOString(),
    status: "pending",
  };
  // Persist interests alongside the pending slot so a later scheduled fire has
  // something to research even with no browser attached.
  await saveState({ ...state, interests, last_brief: pending }, deps.stateFile);

  void runSynthesis(topics, briefId, deps, source, {
    researchTopics: isRetry ? retryTopics : topics,
    baseMarkdown: isRetry ? baseMarkdown : undefined,
    retryTopics: isRetry ? retryTopics : undefined,
  });
  return { started: true, briefId };
}

type SynthesisPlan = {
  // The topics to actually hand to claude this run (subset on retry, all else).
  researchTopics: string[];
  // On retry: the prior brief markdown to merge fresh sections into.
  baseMarkdown?: string;
  // On retry: which topics the fresh markdown should overwrite in the base.
  retryTopics?: string[];
};

async function runSynthesis(
  interests: string[],
  briefId: string,
  deps: RunDeps,
  source: RunSource,
  plan: SynthesisPlan,
): Promise<void> {
  let brief: Brief;
  try {
    const fresh = await researchAndSynthesize(plan.researchTopics, {
      claudeBin: deps.claudeBin,
      spawnFn: deps.spawnFn,
    });
    // On a focused retry, splice the fresh sections into the prior brief so the
    // topics that already worked are preserved verbatim; otherwise the fresh
    // markdown IS the whole brief. Coverage is always computed over the FULL
    // interest list so the UI sees an honest per-topic status for every topic.
    const summary =
      plan.baseMarkdown && plan.retryTopics
        ? mergeBriefSections(plan.baseMarkdown, fresh, plan.retryTopics)
        : fresh;
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "ready",
      summary_md: summary,
      topics: computeCoverage(interests, summary),
    };
  } catch (err) {
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "failed",
      error_msg: String(err),
    };
  }

  try {
    // Reload to avoid clobbering a concurrent schedule reschedule() that may
    // have written next_run_at while synthesis was running.
    const fresh = await loadState(deps.stateFile);
    let schedule = fresh.schedule;
    if (source === "scheduled" && schedule) {
      schedule = {
        ...schedule,
        last_run_at: brief.generated_at,
        last_run_status: brief.status === "ready" ? "success" : "failed",
        last_run_note: brief.status === "failed" ? brief.error_msg : undefined,
      };
    }
    await saveState({ ...fresh, last_brief: brief, schedule }, deps.stateFile);
  } finally {
    // Always clear the in-flight guard, even if persistence throws, so the
    // companion can't wedge into a permanent "in progress" state.
    runInFlight = false;
  }

  deps.onSynthesisDone?.(brief);
}

// Record that a scheduled fire was skipped (a run was already in flight, or no
// interests were stored). Keeps the schedule legible: the UI can show "last
// fire skipped — already running / no interests set" rather than silence.
export async function recordScheduledSkip(
  stateFile: string,
  note: string,
  whenIso: string,
): Promise<void> {
  const state = await loadState(stateFile);
  if (!state.schedule) return;
  const schedule: ScheduleConfig = {
    ...state.schedule,
    last_run_at: whenIso,
    last_run_status: "skipped",
    last_run_note: note,
  };
  await saveState({ ...state, schedule }, stateFile);
}
