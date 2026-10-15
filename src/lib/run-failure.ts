// Run health for the feed's banner: did the latest run fail, or has no brief
// succeeded for over a day? Read-only: it never writes interests or starts a
// run.

import { fetchSchedule, logCompanionError, readBriefSlot } from "./companion";

// A surfaced "your daily run failed / silently stopped" signal. A failed run
// overwrites `last_brief` with status:"failed" and never enters the ready
// history — so the feed would silently keep showing the last success, read as
// "no new run". This makes that state HONEST: the feed shows a clear banner
// with the captured reason instead of pretending yesterday's brief is today's.
export type RunFailure = {
  // "failed": the most recent run errored. "stale": no successful brief in the
  // staleness window even though nothing errored in the current slot (e.g. every
  // scheduled fire was skipped) — a silent stop.
  kind: "failed" | "stale";
  // Human reason for a failed run (usage limit vs spawn error vs timeout),
  // distilled by the companion into last_brief.error_msg / the schedule note.
  reason?: string;
  // ISO of the failed run (failed) — for display context.
  at?: string;
  // ISO of the newest successful brief we still have, if any.
  lastSuccessAt?: string;
};

// Alert threshold: flag a silent stop when the last SUCCESSFUL
// brief is older than this, even if the current slot didn't explicitly error.
const STALE_SUCCESS_MS = 26 * 60 * 60 * 1000; // 26h

// Strip the companion's internal "all research sessions failed — " prefix so the
// banner's own "Today's brief failed —" lead-in doesn't read as a doubled clause.
function cleanFailureReason(msg?: string | null): string | undefined {
  if (!msg) return undefined;
  const trimmed = msg
    .replace(/^all research sessions failed\s*[—:-]\s*/i, "")
    .trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Pure assessment (unit-friendly): given the raw last_brief slot, the schedule
// telemetry, and the newest successful brief's timestamp, decide whether to
// surface a failure/staleness banner. Returns null when the run is healthy.
export function assessRunFailure(input: {
  lastStatus?: string;
  lastError?: string | null;
  lastAt?: string | null;
  scheduleStatus?: "success" | "failed" | "skipped" | null;
  scheduleNote?: string | null;
  scheduleAt?: string | null;
  lastSuccessAt?: string | null;
  now: number;
}): RunFailure | null {
  const {
    lastStatus,
    lastError,
    lastAt,
    scheduleStatus,
    scheduleNote,
    scheduleAt,
    lastSuccessAt,
    now,
  } = input;

  // 1. The most recent run errored — on-demand (last_brief) or scheduled
  //    (schedule.last_run_status). Prefer the brief's captured error; fall back
  //    to the schedule's note.
  if (lastStatus === "failed" || scheduleStatus === "failed") {
    const failedAt =
      lastStatus === "failed"
        ? (lastAt ?? null)
        : (scheduleAt ?? lastAt ?? null);
    // A failure only reflects the CURRENT state if no successful brief is newer
    // than it. `schedule.last_run_status` is written ONLY by scheduled runs
    // (runner.ts), so a 07:00 scheduled fire that failed but was superseded by a
    // successful on-demand "Run now" at 09:00 leaves a STALE "failed" flag —
    // last_brief is a fresh 09:00 ready brief yet scheduleStatus stays "failed".
    // Without this guard the feed shows a self-contradictory banner ("Today's
    // brief failed … showing your last good brief from 09:00") over that fresh
    // 09:00 brief, and it persists across every reload until the next scheduled
    // fire overwrites the flag. The failed-last_brief path is unaffected: it IS
    // the most recent run of any kind, so its lastSuccessAt (from ready history)
    // is always older and never supersedes it.
    const supersededByNewerSuccess =
      lastSuccessAt != null &&
      failedAt != null &&
      Date.parse(lastSuccessAt) > Date.parse(failedAt);
    if (!supersededByNewerSuccess) {
      const reason =
        cleanFailureReason(lastError) ?? cleanFailureReason(scheduleNote);
      return {
        kind: "failed",
        reason,
        at: failedAt ?? undefined,
        lastSuccessAt: lastSuccessAt ?? undefined,
      };
    }
  }

  // 2. No successful brief within the staleness window — a silent stop even when
  //    nothing errored in THIS slot (e.g. every fire was skipped). Only meaningful
  //    once we've ever had a success to measure against.
  if (lastSuccessAt) {
    const age = now - Date.parse(lastSuccessAt);
    if (Number.isFinite(age) && age > STALE_SUCCESS_MS) {
      return { kind: "stale", lastSuccessAt };
    }
  }
  return null;
}

// Fetch the companion's run health and assess it. Read-only (GET only) — never
// writes interests or kicks a run. Returns null when healthy or unreachable.
export async function fetchRunFailure(
  token: string,
): Promise<RunFailure | null> {
  try {
    // A QA/dry-run result is not the user's run-health state, so `slot` skips
    // ephemeral briefs; `lastGood` backs "last good brief from <date>".
    const [{ slot, lastGood }, schedule] = await Promise.all([
      readBriefSlot(token),
      fetchSchedule(token).catch(() => null),
    ]);
    return assessRunFailure({
      lastStatus: slot?.status,
      lastError: slot?.error_msg,
      lastAt: slot?.generated_at,
      scheduleStatus: schedule?.last_run_status ?? null,
      scheduleNote: schedule?.last_run_note ?? null,
      scheduleAt: schedule?.last_run_at ?? null,
      lastSuccessAt: lastGood?.generatedAt ?? null,
      now: Date.now(),
    });
  } catch (err) {
    logCompanionError("run-failure-fetch", err);
    return null;
  }
}
