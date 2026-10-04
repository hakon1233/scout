// /v0/schedule — recurring-run config read/write for the Settings UI.

import {
  loadState,
  normalizeTimeOfDay,
  updateState,
  defaultSchedule,
  type ScheduleConfig,
} from "../state.js";
import { isServiceInstalled } from "../service.js";
import { json, jsonBodyParseError, parseJsonBody } from "../http-util.js";
import type { ScheduleView } from "../contract.js";
import type { AuthedRequestContext, ServerContext } from "./types.js";

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
// for the Settings UI. Materializes the default schedule on
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
  { req, res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{
    enabled?: unknown;
    time_of_day?: unknown;
  }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;

  if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
    return json(res, 400, { error: "enabled must be a boolean" }, cors);
  }
  const enabled = parsed.enabled;
  let timeOfDay: string | undefined;
  if (parsed.time_of_day !== undefined) {
    const normalized = normalizeTimeOfDay(parsed.time_of_day);
    if (!normalized) {
      return json(res, 400, { error: "time_of_day must be 'HH:MM' (24h)" }, cors);
    }
    timeOfDay = normalized;
  }

  // Only enabled and time_of_day come from the request; the run telemetry the
  // scheduler maintains is kept from the state on disk.
  const saved = await updateState(sc.stateFile, (state) => {
    const current = state.schedule ?? defaultSchedule();
    const next: ScheduleConfig = {
      ...current,
      enabled: enabled ?? current.enabled,
      time_of_day: timeOfDay ?? current.time_of_day,
    };
    return { ...state, schedule: next };
  });
  const next = saved.schedule ?? defaultSchedule();
  // Re-arm the live scheduler; it also persists the recomputed
  // next_run_at, so re-read before returning the view.
  await sc.onScheduleChanged?.();
  const fresh = await loadState(sc.stateFile);
  json(res, 200, scheduleView(fresh.schedule ?? next), cors);
}
