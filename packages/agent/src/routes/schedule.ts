// /v0/schedule — recurring-run config read/write for the Settings UI
// (PER-152). Moved out of server.ts in the PER-274 split; behavior unchanged.

import {
  loadState,
  normalizeTimeOfDay,
  saveState,
  defaultSchedule,
  type ScheduleConfig,
} from "../state.js";
import { isServiceInstalled } from "../service.js";
import { json, jsonBodyParseError, parseJsonBody } from "../http-util.js";
import type { AuthedRequestContext, ServerContext } from "./types.js";

// Shape GET /v0/schedule returns and PUT echoes back — the contract the
// Settings UI (PER-152) consumes. `reboot_durable` is true once a launchd
// LaunchAgent (PER-153) is installed: launchd then restarts the companion at
// login/boot, so the scheduler survives a reboot. When false the UI warns the
// founder to re-run `scout-agent run` after a reboot.
export type ScheduleView = {
  enabled: boolean;
  time_of_day: string;
  last_run_at: string | null;
  last_run_status: ScheduleConfig["last_run_status"] | null;
  last_run_note: string | null;
  next_run_at: string | null;
  reboot_durable: boolean;
};

function scheduleView(cfg: ScheduleConfig): ScheduleView {
  return {
    enabled: cfg.enabled,
    time_of_day: cfg.time_of_day,
    last_run_at: cfg.last_run_at ?? null,
    last_run_status: cfg.last_run_status ?? null,
    last_run_note: cfg.last_run_note ?? null,
    next_run_at: cfg.next_run_at ?? null,
    // Honest, live signal: reflects whether the durable LaunchAgent is installed
    // right now (plist present), so installing/uninstalling flips this with no
    // restart or config write.
    reboot_durable: isServiceInstalled(),
  };
}

// Read the persisted recurring-schedule config + last/next-run telemetry
// for the Settings UI (PER-152). Materializes the default schedule on
// first read so the UI always has something concrete to render.
export async function handleGetSchedule(
  { res, cors, state }: AuthedRequestContext,
): Promise<void> {
  const cfg = state.schedule ?? defaultSchedule();
  json(res, 200, scheduleView(cfg), cors);
}

// Write the schedule config (enable/disable + time-of-day). Telemetry
// fields are read-only here. After persisting we ask the running
// scheduler to re-arm so the change takes effect without a restart.
export async function handlePutSchedule(
  { req, res, cors, state }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{
    enabled?: unknown;
    time_of_day?: unknown;
  }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;

  const current = state.schedule ?? defaultSchedule();
  let enabled = current.enabled;
  if (parsed.enabled !== undefined) {
    if (typeof parsed.enabled !== "boolean") {
      return json(res, 400, { error: "enabled must be a boolean" }, cors);
    }
    enabled = parsed.enabled;
  }
  let timeOfDay = current.time_of_day;
  if (parsed.time_of_day !== undefined) {
    const normalized = normalizeTimeOfDay(parsed.time_of_day);
    if (!normalized) {
      return json(res, 400, { error: "time_of_day must be 'HH:MM' (24h)" }, cors);
    }
    timeOfDay = normalized;
  }

  const next: ScheduleConfig = {
    ...current,
    enabled,
    time_of_day: timeOfDay,
  };
  await saveState({ ...state, schedule: next }, sc.stateFile);
  // Re-arm the live scheduler; it also persists the recomputed
  // next_run_at, so re-read before returning the view.
  await sc.onScheduleChanged?.();
  const fresh = await loadState(sc.stateFile);
  json(res, 200, scheduleView(fresh.schedule ?? next), cors);
}
