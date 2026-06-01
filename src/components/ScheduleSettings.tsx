"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Card, Section, Toggle } from "@/components/ui";
import {
  bootstrapCompanionToken,
  type CompanionSchedule,
  fetchSchedule,
  updateSchedule,
} from "@/lib/companion";

// Settings UI for the recurring schedule (PER-152). Reads/writes the companion's
// GET|PUT /v0/schedule contract (PER-151): an enable toggle + time-of-day picker,
// the last/next-run legibility row, and an honest reboot caveat. Every control
// drives a real backend write — no setting that saves nothing (PER-139).

type LoadState =
  | { kind: "loading" }
  | { kind: "unreachable" } // companion not paired / not running
  | { kind: "ready"; schedule: CompanionSchedule };

// "07:00" → "7:00 AM" in the viewer's locale, without inventing a date the user
// would see. We anchor to a fixed throwaway day purely to format the clock time.
function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_TONE: Record<
  NonNullable<CompanionSchedule["last_run_status"]>,
  { label: string; cls: string }
> = {
  success: { label: "Succeeded", cls: "text-success" },
  failed: { label: "Failed", cls: "text-danger" },
  skipped: { label: "Skipped", cls: "text-warning" },
};

function LastRunRow({ schedule }: { schedule: CompanionSchedule }) {
  if (!schedule.last_run_at) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-caption uppercase text-muted">Last run</span>
        <span className="text-body-sm text-secondary">
          No scheduled run yet.
        </span>
      </div>
    );
  }
  const status = schedule.last_run_status
    ? STATUS_TONE[schedule.last_run_status]
    : null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase text-muted">Last run</span>
      <span className="text-body-sm text-primary">
        {formatTimestamp(schedule.last_run_at)}
        {status && (
          <>
            {" · "}
            <span className={`font-medium ${status.cls}`}>{status.label}</span>
          </>
        )}
      </span>
      {schedule.last_run_note && (
        <span className="text-caption text-muted">{schedule.last_run_note}</span>
      )}
    </div>
  );
}

function NextRunRow({ schedule }: { schedule: CompanionSchedule }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase text-muted">Next run</span>
      <span className="text-body-sm text-primary">
        {schedule.enabled && schedule.next_run_at
          ? formatTimestamp(schedule.next_run_at)
          : "—"}
      </span>
    </div>
  );
}

export function ScheduleSettings() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string>("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError(null);
    try {
      const token = await bootstrapCompanionToken();
      tokenRef.current = token;
      if (!token) {
        setState({ kind: "unreachable" });
        return;
      }
      const schedule = await fetchSchedule(token);
      setState({ kind: "ready", schedule });
    } catch {
      // requireBase() throws when the companion isn't reachable — that's the
      // expected "not paired / not running" state, not an error to alarm about.
      setState({ kind: "unreachable" });
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount; `load` flips to a loading state then resolves
    // async. Same canonical sync pattern as the app page's hydration effects.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Commit a patch, then render exactly what the companion echoes back —
  // including the recomputed next_run_at. On failure we re-fetch so the UI
  // never drifts from persisted truth, and surface the human-readable reason.
  const commit = useCallback(
    async (patch: { enabled?: boolean; time_of_day?: string }) => {
      if (state.kind !== "ready") return;
      setSaving(true);
      setError(null);
      try {
        const next = await updateSchedule(patch, tokenRef.current);
        setState({ kind: "ready", schedule: next });
      } catch (e) {
        setError((e as Error)?.message ?? "Couldn't save the schedule.");
        // Re-pull persisted truth so the control snaps back from the rejected
        // optimistic value.
        try {
          const fresh = await fetchSchedule(tokenRef.current);
          setState({ kind: "ready", schedule: fresh });
        } catch {
          /* leave the prior state; the error banner explains it */
        }
      } finally {
        setSaving(false);
      }
    },
    [state],
  );

  if (state.kind === "loading") {
    return (
      <Section
        as="section"
        title="Scheduled briefs"
        description="Loading schedule…"
      >
        <Card tone="muted" className="h-20 animate-pulse" aria-hidden="true" />
      </Section>
    );
  }

  if (state.kind === "unreachable") {
    return (
      <Section
        as="section"
        title="Scheduled briefs"
        description="Run a fresh brief automatically at a set time each day."
      >
        <Banner tone="info">
          <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Scheduling lives on your local Scout companion. Start{" "}
              <code className="font-mono text-mono-xs">scout-agent run</code> to
              configure it.
            </span>
            <Link
              href="/app/connect"
              className="shrink-0 text-caption uppercase text-muted underline transition hover:text-primary"
            >
              Pair companion →
            </Link>
          </span>
        </Banner>
      </Section>
    );
  }

  const { schedule } = state;

  return (
    <Section
      as="section"
      title="Scheduled briefs"
      description="Run a fresh brief automatically at a set time each day."
    >
      <Card tone="muted" className="flex flex-col gap-4">
        {/* Enable / disable */}
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="schedule-enabled"
            className="flex flex-col gap-0.5"
          >
            <span className="text-body-sm font-medium text-primary">
              Daily brief
            </span>
            <span className="text-caption text-muted">
              {schedule.enabled
                ? `On · runs at ${formatTimeOfDay(schedule.time_of_day)}`
                : "Off"}
            </span>
          </label>
          <Toggle
            id="schedule-enabled"
            label="Enable the daily scheduled brief"
            checked={schedule.enabled}
            busy={saving}
            onChange={(next) => commit({ enabled: next })}
          />
        </div>

        {/* Time-of-day picker */}
        <div className="flex items-center justify-between gap-4 border-t border-border-default pt-4">
          <label
            htmlFor="schedule-time"
            className={`flex flex-col gap-0.5 ${schedule.enabled ? "" : "opacity-60"}`}
          >
            <span className="text-body-sm font-medium text-primary">
              Run at
            </span>
            <span className="text-caption text-muted">
              Local time, every day
            </span>
          </label>
          <input
            id="schedule-time"
            type="time"
            value={schedule.time_of_day}
            disabled={!schedule.enabled || saving}
            onChange={(e) => {
              const v = e.target.value; // native "HH:MM"
              if (v) commit({ time_of_day: v });
            }}
            className={
              "rounded-md border border-border-strong bg-surface px-3 py-2 text-body-sm text-primary shadow-sm outline-none transition " +
              "focus:border-focus-ring focus:ring-1 focus:ring-focus-ring " +
              "disabled:opacity-60 disabled:cursor-not-allowed"
            }
          />
        </div>

        {/* Legibility row: last + next run */}
        <div className="grid grid-cols-1 gap-4 border-t border-border-default pt-4 sm:grid-cols-2">
          <LastRunRow schedule={schedule} />
          <NextRunRow schedule={schedule} />
        </div>
      </Card>

      {error && (
        <Banner tone="danger">
          <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={() => load()}>
              Retry
            </Button>
          </span>
        </Banner>
      )}

      {/* Reboot caveat — honest, calm, only when scheduling is on (PER-139). */}
      {schedule.enabled && !schedule.reboot_durable && (
        <p className="text-caption text-muted">
          Scheduled runs only happen while the companion is running. After a
          reboot, start it again with{" "}
          <code className="font-mono text-mono-xs">scout-agent run</code>.
        </p>
      )}
    </Section>
  );
}
