// In-process scheduler (PER-151). While the companion process is alive it fires
// the shared brief-run path (runner.ts) on a recurring daily schedule, so the
// founder gets a fresh brief at a configured time without doing anything.
//
// Reboot caveat (surfaced, not swallowed): `scout-agent run` (nohup) is NOT
// reboot-durable. This timer only exists while the process lives; after a Mac
// mini reboot the founder must re-run `scout-agent run`. GET /v0/schedule
// exposes `reboot_durable: false` so the Settings UI (PER-152) can warn. A
// launchd login item / durable `serve` is an optional follow-up, not built here.

import {
  defaultSchedule,
  loadState,
  normalizeTimeOfDay,
  saveState,
  type Brief,
} from "./state.js";
import {
  recordScheduledSkip,
  startRun,
  type RunDeps,
  type RunOptions,
  type RunSource,
} from "./runner.js";

// setTimeout overflows past ~24.8 days (2^31-1 ms) and fires immediately. Daily
// schedules are always well under that, but clamp defensively.
const MAX_TIMER_MS = 2_147_483_647;

// PER-259 item 3: automatically RETRY a failed scheduled run a few times, spaced
// out, before giving up for the day. The PER-258 outage was a transient Claude
// usage/session-limit at exactly 07:00 that killed the WHOLE day's brief with no
// self-heal — the founder saw a silent stop. Re-running ~45 min later a handful
// of times rides over that limit window (which typically clears within an hour)
// without any founder intervention, and would have prevented most of PER-258
// outright. Like the schedule itself this lives in-process (not reboot-durable) —
// an accepted limit; a durable LaunchAgent (PER-153) is the reboot story.
const RETRY_DELAY_MS = 45 * 60 * 1000; // 45 min between attempts
const MAX_SCHEDULED_RETRIES = 3; // up to 3 retries → 4 attempts total (~07:00–09:15)

// Topics the model DROPPED in `brief` (coverage "missing") — exactly what a
// focused retry can recover by re-researching just them and merging into the
// ready base. Empty for a pending/failed brief (no coverage computed) or a
// fully-covered one. A wholesale failure therefore yields [] here, so its retry
// re-runs the FULL list (there's no base brief to merge a subset into).
function missingTopics(brief: Brief | undefined): string[] {
  if (!brief || brief.status !== "ready" || !brief.topics) return [];
  return brief.topics.filter((t) => t.status === "missing").map((t) => t.topic);
}

// Compute the next fire time strictly AFTER `from` for a local "HH:MM". Returns
// null if timeOfDay is malformed. Exported for unit testing the rollover logic.
export function nextFireAt(timeOfDay: string, from: Date): Date | null {
  // Canonicalize through the single source-of-truth validator (state.ts) instead
  // of a second, stricter regex. Previously this required exactly `HH:MM` while
  // normalizeTimeOfDay accepts `H:MM` and zero-pads — so a `"7:00"` reaching the
  // scheduler by any path that skipped normalization (a hand-edited/legacy
  // state.json) parsed as null here and silently disabled the schedule (AIR-188
  // L1). One validator → no drift.
  const normalized = normalizeTimeOfDay(timeOfDay);
  if (!normalized) return null;
  const [hh, mm] = normalized.split(":").map(Number);
  const next = new Date(from);
  next.setHours(hh, mm, 0, 0);
  // If today's time already passed (or is exactly now), roll to tomorrow.
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly deps: RunDeps;
  // Injectable clock for tests; defaults to real time.
  private readonly now: () => Date;
  // Retry/backoff state for a failed scheduled run (PER-259 item 3).
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(
    deps: RunDeps,
    now: () => Date = () => new Date(),
    // Test hooks: shrink the backoff and budget so the retry path is exercised
    // without waiting 45 real minutes. Production uses the module defaults.
    opts: { retryDelayMs?: number; maxRetries?: number } = {},
  ) {
    this.deps = deps;
    this.now = now;
    this.retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
    this.maxRetries = opts.maxRetries ?? MAX_SCHEDULED_RETRIES;
  }

  // Read persisted config and arm the next timer. Call on startup and after any
  // config change. Resolves once the next_run_at telemetry is persisted.
  async start(): Promise<void> {
    await this.reschedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearRetry();
  }

  // Cancel any pending failed-run retry (e.g. on stop, or when a fresh daily
  // fire supersedes yesterday's retry chain).
  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // Re-read schedule config from state, clear any pending timer, and arm a fresh
  // one (or none, if disabled). Persists the computed next_run_at so the UI can
  // show it. This is the single writer of schedule.next_run_at.
  async reschedule(): Promise<void> {
    this.stop();
    const state = await loadState(this.deps.stateFile);
    const cfg = state.schedule ?? defaultSchedule();

    if (!cfg?.enabled) {
      if (cfg?.next_run_at) {
        await saveState(
          { ...state, schedule: { ...cfg, next_run_at: undefined } },
          this.deps.stateFile,
        );
      }
      return;
    }

    const from = this.now();
    const next = nextFireAt(cfg.time_of_day, from);
    if (!next) {
      // Malformed time-of-day shouldn't happen (PUT validates) but never wedge.
      return;
    }

    await saveState(
      { ...state, schedule: { ...cfg, next_run_at: next.toISOString() } },
      this.deps.stateFile,
    );

    const delay = Math.max(
      0,
      Math.min(next.getTime() - from.getTime(), MAX_TIMER_MS),
    );
    // fire() does disk I/O (reschedule/loadState/startRun); a throw on this
    // timer path would be an unhandled rejection — a process-crash risk under
    // Node's default handling, and totally silent (every test drives fire()
    // directly/awaited, so only this automatic path is exposed). Log it so a
    // "my scheduled brief silently never ran" report is diagnosable from stderr.
    // Matches the runner.ts:279 / chat.ts:708 catch pattern.
    //
    // Clear-before-arm (AIR-471): `stop()` at the top of reschedule() nulls the
    // timer, but re-arming happens here AFTER two awaits (loadState/saveState).
    // Two overlapping reschedule() calls (a fire()'s re-arm racing an
    // onScheduleChanged PUT) each pass their stop() before either arms, then both
    // arm — orphaning the first timer, which stays live and double-fires the
    // daily run. Clearing whatever handle exists right before reassigning means
    // whichever call arms last cancels the other's timer; a no-op on the common
    // (non-raced) path where `this.timer` is already null.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () =>
        void this.fire().catch((err) => {
          console.error("[scheduler] scheduled fire failed:", err);
        }),
      delay,
    );
    // Don't keep the event loop alive purely for the schedule — the HTTP server
    // is what keeps the process up. (No-op under test harnesses that lack unref.)
    this.timer.unref?.();
  }

  // Fire a scheduled run, then re-arm for the next day. Runs through the shared
  // path so it's identical to an on-demand run; concurrency-safe via runner's
  // single-flight guard. Public so tests can trigger a fire deterministically.
  async fire(): Promise<void> {
    // A fresh daily fire supersedes any retry chain still pending from an
    // earlier day and resets the retry budget for today.
    this.clearRetry();
    this.retryCount = 0;

    const whenIso = this.now().toISOString();

    // Re-arm for tomorrow FIRST. The run's success/failure telemetry
    // (schedule.last_run_*) is written asynchronously when synthesis finishes;
    // by persisting next_run_at before kicking the run, every write to the
    // `schedule` object is sequential (reschedule → startRun → completion),
    // so the two writers can't clobber each other's fields.
    await this.reschedule();

    await this.runScheduled(whenIso, false);
  }

  // Kick one scheduled run through the shared path. `isRetry` distinguishes the
  // automatic backoff re-runs (PER-259 item 3) from the daily fire: a retry of a
  // PARTIAL failure re-researches only the dropped topics and merges into the
  // ready base, while a retry of a WHOLESALE failure (no base brief) re-runs the
  // full list. The outcome is observed via a wrapped onSynthesisDone (see
  // `retryAwareDeps`) so a failed run arms the next retry.
  private async runScheduled(whenIso: string, isRetry: boolean): Promise<void> {
    const state = await loadState(this.deps.stateFile);
    const interests = state.interests ?? [];

    const opts: RunOptions = {};
    if (isRetry) {
      const missing = missingTopics(state.last_brief);
      // Only a ready-but-partial brief has a base to merge a focused retry into.
      // A fully-failed prior run yields no missing topics here, so this stays a
      // full re-run — which is exactly what recovers the PER-258 total failure.
      if (state.last_brief?.status === "ready" && missing.length > 0) {
        opts.retryTopics = missing;
      }
    }

    const source: RunSource = "scheduled";
    const outcome = await startRun(
      interests,
      this.retryAwareDeps(),
      source,
      opts,
    );

    if (!outcome.started) {
      const note =
        outcome.reason === "in_flight"
          ? "a run was already in progress when the schedule fired"
          : outcome.reason === "no_base_brief"
            ? "retry skipped — no base brief to merge the failed topics into"
            : "no interests stored yet — set interests to enable scheduled briefs";
      await recordScheduledSkip(this.deps.stateFile, note, whenIso);
      // Nothing was spawned, so onSynthesisDone won't fire to arm a retry. A skip
      // is not a failure worth retrying (a run is already in flight, or there's
      // nothing to run), so the retry chain stops here for the day.
    }
  }

  // Wrap the caller's onSynthesisDone so we ALSO observe every scheduled run's
  // outcome and arm a backoff retry when it failed (PER-259 item 3). runSynthesis
  // invokes this AFTER clearing the in-flight guard, so an armed retry can start
  // a fresh run cleanly.
  private retryAwareDeps(): RunDeps {
    return {
      ...this.deps,
      onSynthesisDone: (brief: Brief) => {
        this.deps.onSynthesisDone?.(brief);
        this.onScheduledRunDone(brief);
      },
    };
  }

  // Decide whether a completed scheduled run warrants an automatic retry. A
  // wholesale failure (no brief at all) or a partial brief with dropped topics is
  // retryable; a clean/empty-but-covered brief is done. Bounded by the retry
  // budget so a persistently-broken morning (e.g. usage limit that never clears)
  // gives up gracefully instead of hammering.
  private onScheduledRunDone(brief: Brief): void {
    const failedWholeRun = brief.status === "failed";
    const droppedTopics = missingTopics(brief).length > 0;
    if (!failedWholeRun && !droppedTopics) {
      this.retryCount = 0;
      return;
    }
    if (this.retryCount >= this.maxRetries) {
      console.warn(
        `[scheduler] scheduled run still failing after ${this.retryCount} ` +
          `retr${this.retryCount === 1 ? "y" : "ies"}; giving up until the next daily fire`,
      );
      return;
    }
    this.retryCount += 1;
    console.warn(
      `[scheduler] scheduled run ${failedWholeRun ? "failed" : "dropped topics"}; ` +
        `auto-retry ${this.retryCount}/${this.maxRetries} in ` +
        `${Math.round(this.retryDelayMs / 60000)} min`,
    );
    this.armRetry();
  }

  private armRetry(): void {
    this.clearRetry();
    const delay = Math.min(this.retryDelayMs, MAX_TIMER_MS);
    this.retryTimer = setTimeout(
      () =>
        void this.runScheduledRetry().catch((err) => {
          // Mirrors the reschedule()/runner catch pattern: a throw on this timer
          // path would be a silent unhandled rejection.
          console.error("[scheduler] scheduled retry failed:", err);
        }),
      delay,
    );
    this.retryTimer?.unref?.();
  }

  private async runScheduledRetry(): Promise<void> {
    this.retryTimer = null;
    await this.runScheduled(this.now().toISOString(), true);
  }
}
