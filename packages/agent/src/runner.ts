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
import path from "node:path";
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
import {
  computeCoverage,
  mergeBriefSections,
  extractTopicSection,
  assembleBrief,
} from "./coverage.js";
import { ensureInterestDoc } from "./docs.js";

export type RunDeps = {
  stateFile: string;
  claudeBin?: string;
  // Spawn override for tests; production uses node:child_process spawn.
  spawnFn?: typeof spawn;
  // Where per-interest intent docs live (C2/PER-171). Defaults to the
  // `interests/` dir beside the state file, which in production resolves to
  // `~/.config/scout/interests` (=== docs.ts INTERESTS_DIR) and in tests
  // automatically lands in the tmp dir alongside the tmp stateFile, so the lazy
  // doc-backfill never touches the real config dir.
  interestsDir?: string;
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
  // Run-selector path (C6/PER-173): research ONLY this subset of `interests`
  // and produce a FRESH brief containing just those sections — distinct from
  // `retryTopics`, which merges a subset into a prior brief. Coverage is then
  // computed over the SELECTED set (not the full list), so a one-interest run
  // yields a brief + coverage covering only that topic. The FULL interest list
  // is still persisted to state (the scheduler's source of truth) — a partial
  // run never shrinks the saved set. Must be a subset of `interests`; ignored
  // when `retryTopics` is set (a retry already carries its own subset) or when
  // it covers the whole list (that's just a normal full run).
  selectedTopics?: string[];
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

// How long a persisted `pending` brief may survive WITHOUT this process actively
// running it before we treat it as an abandoned/crashed run and reclaim the slot
// (PER-181). Background: within a live process, `runInFlight === true` for the
// entire lifetime of a real run, so a second request is correctly blocked. The
// ONLY way to see a persisted `pending` while `runInFlight === false` is a
// process that died between writing the pending slot and finishing synthesis
// (launchd KeepAlive restart, sleep, OOM). Before this guard that bricked the
// companion permanently: every later run saw the stale `pending` and returned
// `in_flight` forever. We still require the pending to be older than this grace
// window so we never stomp a slot a (hypothetical) sibling process just wrote.
// The window must exceed a realistic full run: N interests × per-session timeout
// (research.ts DEFAULT_SESSION_TIMEOUT_MS = 4 min). 30 min covers a slow ~7-topic
// run while still reclaiming a genuinely dead run on the next attempt.
const STALE_PENDING_MS = 30 * 60 * 1000;

// A persisted pending brief is reclaimable iff we are NOT the process running it
// (in-memory `runInFlight` is the authoritative "live run" signal) AND it has
// outlived the grace window — i.e. it belongs to a process that died mid-run.
function isStalePending(brief: Brief | undefined, now: number): boolean {
  if (!brief || brief.status !== "pending") return false;
  if (runInFlight) return false; // this process owns a live run — not stale.
  const startedAt = Date.parse(brief.generated_at);
  if (!Number.isFinite(startedAt)) return true; // unparseable → treat as dead.
  return now - startedAt > STALE_PENDING_MS;
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

  // A live run in THIS process always blocks (in-memory guard, set synchronously
  // before the pending slot is persisted — closes the loadState→saveState gap).
  if (runInFlight) {
    return { started: false, reason: "in_flight", briefId: state.last_brief?.id };
  }
  // A persisted `pending` blocks a new run too — UNLESS it's stale, meaning the
  // process that wrote it died mid-run (PER-181). A stale pending is reclaimed:
  // we fall through and overwrite it with a fresh run rather than wedging
  // forever on a brief no live process will ever finish.
  if (state.last_brief?.status === "pending" && !isStalePending(state.last_brief, Date.now())) {
    return { started: false, reason: "in_flight", briefId: state.last_brief?.id };
  }
  if (interests.length === 0) {
    return { started: false, reason: "no_interests" };
  }

  // Coverage is computed over the FULL interest list so the UI sees an honest
  // per-topic status for every topic, whatever subset this run researches.
  const topics = interestTopics(interests);

  // A focused retry only makes sense when there's a prior ready brief to merge
  // the fresh sections into; without one there's nothing to preserve, so the
  // caller should run a full brief instead. We narrow to the retry topics that
  // are actually part of the current interest list (ignore stale/foreign ones),
  // then map them back to the rich interests so each retried session still
  // carries its own intent doc.
  const baseMarkdown = state.last_brief?.summary_md;
  const retryTopics = (opts.retryTopics ?? []).filter((t) => topics.includes(t));
  const isRetry = retryTopics.length > 0;
  if (isRetry && !baseMarkdown) {
    return { started: false, reason: "no_base_brief" };
  }
  const retrySet = new Set(retryTopics);

  // Run-selector subset (C6/PER-173). Only honored when this isn't a retry and
  // the selection is a STRICT subset of the interest list; a selection equal to
  // (or a superset of) the full list collapses to a normal full run. We narrow
  // to topics actually in the current list so a stale/foreign topic can't sneak
  // an empty section into the brief.
  const selectedTopics = (opts.selectedTopics ?? []).filter((t) =>
    topics.includes(t),
  );
  const isSelected =
    !isRetry &&
    selectedTopics.length > 0 &&
    selectedTopics.length < topics.length;
  const selectedSet = new Set(selectedTopics);

  const researchInterests = isRetry
    ? interests.filter((i) => retrySet.has(i.topic))
    : isSelected
      ? interests.filter((i) => selectedSet.has(i.topic))
      : interests;

  // Which interests the brief reports coverage over. A selected run shows only
  // the chosen topics (so an unselected interest isn't dishonestly flagged
  // "missing"); a retry and a full run both cover the whole list.
  const coverageInterests = isSelected ? researchInterests : interests;

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

  void runSynthesis(briefId, deps, source, {
    researchInterests,
    coverageInterests,
    baseMarkdown: isRetry ? baseMarkdown : undefined,
    retryTopics: isRetry ? retryTopics : undefined,
  });
  return { started: true, briefId };
}

type SynthesisPlan = {
  // The interests to actually research this run, each in its own per-interest
  // session carrying its intent doc (subset on retry/selected, all else).
  // (C2/PER-171, C6/PER-173)
  researchInterests: Interest[];
  // The interests the assembled brief reports coverage over. The full list for a
  // full run or retry; the selected subset for a run-selector subset run
  // (C6/PER-173) so coverage is honest about exactly what was asked to run.
  coverageInterests: Interest[];
  // On retry: the prior brief markdown to merge fresh sections into.
  baseMarkdown?: string;
  // On retry: which topics the fresh markdown should overwrite in the base.
  retryTopics?: string[];
};

async function runSynthesis(
  briefId: string,
  deps: RunDeps,
  source: RunSource,
  plan: SynthesisPlan,
): Promise<void> {
  const interestsDir =
    deps.interestsDir ?? path.join(path.dirname(deps.stateFile), "interests");
  let brief: Brief;
  try {
    // Run each interest in its OWN headless `claude` session, carrying that
    // interest's intent doc (C2/PER-171) — the invariant the whole epic turns
    // on. Sequential, not concurrent: the synth child runs at niceness 10
    // specifically so it can't starve the loopback server (PER-101), and firing
    // several at once would defeat that. A session that throws or yields nothing
    // contributes no section → assembleBrief omits the topic → computeCoverage
    // reports it "missing" (which PER-154's focused retry can recover).
    const sections: Array<{ topic: string; section: string | null }> = [];
    let anyOk = false;
    for (const interest of plan.researchInterests) {
      try {
        const doc = await ensureInterestDoc(interest.id, interest.topic, interestsDir);
        const sessionMd = await researchAndSynthesize(
          { topic: interest.topic, doc },
          { claudeBin: deps.claudeBin, spawnFn: deps.spawnFn },
        );
        const section = extractTopicSection(sessionMd, interest.topic);
        if (section) anyOk = true;
        sections.push({ topic: interest.topic, section });
      } catch {
        // One topic's session failing must not sink the whole brief — record it
        // as a missing section and keep going.
        sections.push({ topic: interest.topic, section: null });
      }
    }

    // Every researched session failed AND there's no prior brief to fall back
    // on → there's nothing honest to show, so fail the brief (surfaces an error
    // state rather than an empty "# Your brief"). With a base brief, we still
    // merge (preserving the topics that previously worked).
    if (!anyOk && !plan.baseMarkdown) {
      throw new Error("all research sessions failed or returned no content");
    }

    const patch = assembleBrief(sections);
    // On a focused retry, splice the fresh sections into the prior brief so the
    // topics that already worked are preserved verbatim; otherwise the freshly
    // assembled markdown IS the whole brief.
    const summary =
      plan.baseMarkdown && plan.retryTopics
        ? mergeBriefSections(plan.baseMarkdown, patch, plan.retryTopics)
        : patch;
    brief = {
      id: briefId,
      generated_at: new Date().toISOString(),
      status: "ready",
      summary_md: summary,
      topics: computeCoverage(interestTopics(plan.coverageInterests), summary),
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
