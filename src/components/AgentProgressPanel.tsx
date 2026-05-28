"use client";

import * as React from "react";
import { Button, Card } from "@/components/ui";
import type { AgentProgress, InterestState } from "@/lib/agent";

type Props = {
  progress: AgentProgress;
  onCancel?: () => void;
  canCancel?: boolean;
};

export function AgentProgressPanel({
  progress,
  onCancel,
  canCancel = true,
}: Props) {
  return (
    <Card
      tone="muted"
      padding="sm"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Agent progress"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption uppercase text-muted">
              {stageLabel(progress.stage)}
            </p>
            <p className="mt-0.5 text-body-sm text-secondary">
              {progress.message}
            </p>
          </div>
          {canCancel && onCancel && (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>

        <ul className="flex flex-col gap-1.5">
          {progress.perInterest.map((row) => (
            <li
              key={row.topic}
              className="flex items-center justify-between gap-3 text-body-sm"
            >
              <span className="truncate text-primary">{row.topic}</span>
              <StatePill state={row.state} resultCount={row.resultCount} />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function stageLabel(stage: AgentProgress["stage"]): string {
  switch (stage) {
    case "searching":
      return "Searching";
    case "synthesizing":
      return "Synthesizing";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

function StatePill({
  state,
  resultCount,
}: {
  state: InterestState;
  resultCount?: number;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-caption uppercase";
  let className = base;
  let label: string;
  switch (state) {
    case "pending":
      className += " bg-surface text-muted border border-border-default";
      label = "Pending";
      break;
    case "searching":
      className +=
        " bg-accent text-accent-fg scout-shimmer motion-safe:animate-pulse";
      label = "Searching";
      break;
    case "done":
      className += " bg-surface text-secondary border border-border-default";
      label =
        typeof resultCount === "number"
          ? `Done · ${resultCount} result${resultCount === 1 ? "" : "s"}`
          : "Done";
      break;
    case "failed":
      className +=
        " bg-surface text-danger border border-danger-border";
      label = "Failed";
      break;
  }
  return (
    <span className={className} aria-label={label}>
      {label}
    </span>
  );
}
