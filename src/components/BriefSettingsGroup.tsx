"use client";

import * as React from "react";
import { MAX_STORIES, type BriefLength, type BriefSettings } from "@scout/core";
import { Segmented, SettingsGroup, SettingsRow } from "@/components/ui";

const LENGTHS: { value: BriefLength; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "normal", label: "Medium" },
  { value: "long", label: "Long" },
];

const RELEVANT = "relevant";
const STORY_CHOICES: { value: string; label: string }[] = [
  ...Array.from({ length: MAX_STORIES }, (_, i) => ({
    value: String(i + 1),
    label: `Top ${i + 1}`,
  })),
  { value: RELEVANT, label: "Only the most relevant" },
];

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string; change: Partial<BriefSettings> };

/**
 * One topic's brief settings: how long the brief is and how many stories it
 * carries. Each change saves at once through `save`, shows "Saving… → Saved",
 * and on a refusal puts the old value back and offers Retry. Used on the
 * topic page by the companion and the hosted app alike.
 */
export function BriefSettingsGroup({
  settings,
  save,
  extraRows,
}: {
  /** The stored settings, or null while they load. */
  settings: BriefSettings | null;
  /** Saves a change and returns the settings as stored. */
  save: (change: Partial<BriefSettings>) => Promise<BriefSettings>;
  /** Rows that belong in the same group (the hosted run cadence). */
  extraRows?: React.ReactNode;
}) {
  const [shown, setShown] = React.useState<BriefSettings | null>(settings);
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });

  // A reload from outside (another tab, a refetch) wins over what's shown.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- props → local copy
    setShown(settings);
  }, [settings]);

  const apply = React.useCallback(
    async (change: Partial<BriefSettings>) => {
      const before = shown;
      if (!before) return;
      setShown({ ...before, ...change });
      setStatus({ kind: "saving" });
      try {
        setShown(await save(change));
        setStatus({ kind: "saved" });
      } catch (err) {
        setShown(before);
        setStatus({
          kind: "failed",
          message:
            err instanceof Error ? err.message : "Couldn't save the change.",
          change,
        });
      }
    },
    [shown, save],
  );

  const stories = shown?.stories;
  const storiesHint =
    stories === undefined
      ? null
      : stories === RELEVANT
        ? `Only what matters, 0 to ${MAX_STORIES}`
        : `The best ${stories}`;

  return (
    <SettingsGroup
      title="Brief"
      footer={<StatusLine status={status} retry={apply} />}
    >
      {extraRows}
      <SettingsRow label="Length">
        <Segmented
          label="Brief length"
          value={shown?.length ?? null}
          options={LENGTHS}
          disabled={!shown}
          onChange={(length) => void apply({ length })}
        />
      </SettingsRow>
      <SettingsRow label="Stories" hint={storiesHint}>
        <select
          aria-label="How many stories"
          value={stories === undefined ? "" : String(stories)}
          disabled={!shown}
          onChange={(e) => {
            const v = e.target.value;
            void apply({ stories: v === RELEVANT ? RELEVANT : Number(v) });
          }}
          className="min-h-9 rounded-lg bg-surface-muted px-3 text-body-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60 phone:min-h-11"
        >
          {stories === undefined && <option value="">…</option>}
          {STORY_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </SettingsRow>
    </SettingsGroup>
  );
}

function StatusLine({
  status,
  retry,
}: {
  status: Status;
  retry: (change: Partial<BriefSettings>) => Promise<void>;
}) {
  if (status.kind === "failed") {
    return (
      <span role="alert" className="text-danger">
        {status.message}{" "}
        <button
          type="button"
          onClick={() => void retry(status.change)}
          className="underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Retry
        </button>
      </span>
    );
  }
  return (
    <span aria-live="polite">
      {status.kind === "saving"
        ? "Saving…"
        : status.kind === "saved"
          ? "Saved. The next brief uses it."
          : "Applies from the next brief."}
    </span>
  );
}
