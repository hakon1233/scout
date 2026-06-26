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
} from "./state.js";
import {
  recordScheduledSkip,
  startRun,
  type RunDeps,
  type RunSource,
} from "./runner.js";

// setTimeout overflows past ~24.8 days (2^31-1 ms) and fires immediately. Daily
// schedules are always well under that, but clamp defensively.
const MAX_TIMER_MS = 2_147_483_647;

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

  constructor(deps: RunDeps, now: () => Date = () => new Date()) {
    this.deps = deps;
    this.now = now;
  }

  // Read persisted config and arm the next timer. Call on startup and after any
  // config change. Resolves once the next_run_at telemetry is persisted.
  async start(): Promise<void> {
    await this.reschedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
    this.timer = setTimeout(() => void this.fire(), delay);
    // Don't keep the event loop alive purely for the schedule — the HTTP server
    // is what keeps the process up. (No-op under test harnesses that lack unref.)
    this.timer.unref?.();
  }

  // Fire a scheduled run, then re-arm for the next day. Runs through the shared
  // path so it's identical to an on-demand run; concurrency-safe via runner's
  // single-flight guard. Public so tests can trigger a fire deterministically.
  async fire(): Promise<void> {
    const whenIso = this.now().toISOString();

    // Re-arm for tomorrow FIRST. The run's success/failure telemetry
    // (schedule.last_run_*) is written asynchronously when synthesis finishes;
    // by persisting next_run_at before kicking the run, every write to the
    // `schedule` object is sequential (reschedule → startRun → completion),
    // so the two writers can't clobber each other's fields.
    await this.reschedule();

    const state = await loadState(this.deps.stateFile);
    const interests = state.interests ?? [];

    const source: RunSource = "scheduled";
    const outcome = await startRun(interests, this.deps, source);

    if (!outcome.started) {
      const note =
        outcome.reason === "in_flight"
          ? "a run was already in progress when the schedule fired"
          : "no interests stored yet — set interests to enable scheduled briefs";
      await recordScheduledSkip(this.deps.stateFile, note, whenIso);
    }
  }
}
