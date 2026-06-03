"use client";

import * as React from "react";
import type { Interest } from "@/lib/types";

// Run-selector (C6/PER-173): pick one / several / all interests to run at trigger
// time. The selection is a *transient* run-time choice — it never edits the saved
// interest list (that's "Manage interests"); it only narrows which per-interest
// sessions the next "Run now" fires. Direction A editorial: a labelled row of
// toggle pills, all selected by default, with an "All" reset.
type Props = {
  interests: Interest[];
  // The currently-selected topics. Treated as "all" when empty or when it covers
  // the whole list.
  selected: string[];
  onChange: (topics: string[]) => void;
  disabled?: boolean;
};

function pill(active: boolean): string {
  return [
    "inline-flex min-h-[44px] items-center rounded-pill border px-3 py-1.5 text-caption transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
    "disabled:cursor-not-allowed disabled:opacity-50",
    active
      ? "border-border-strong bg-surface-strong font-medium text-primary"
      : "border-border-default bg-surface text-muted hover:bg-surface-muted hover:text-secondary",
  ].join(" ");
}

export function RunScopeSelector({
  interests,
  selected,
  onChange,
  disabled = false,
}: Props) {
  const all = interests.map((i) => i.topic);
  // An empty selection means "all" — render every pill as active.
  const active = new Set(selected.length === 0 ? all : selected);
  const allSelected = active.size === all.length;

  function toggle(topic: string) {
    const next = new Set(active);
    if (next.has(topic)) {
      // Keep at least one — a zero-topic run has nothing to research.
      if (next.size <= 1) return;
      next.delete(topic);
    } else {
      next.add(topic);
    }
    // Emit in interest order so the run + brief sections stay in the user's order.
    onChange(all.filter((t) => next.has(t)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption uppercase tracking-wide text-muted">
        Run scope ·{" "}
        <span className="text-secondary">
          {allSelected ? `all ${all.length}` : `${active.size} of ${all.length}`}
        </span>
      </span>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Choose which interests to run"
      >
        <button
          type="button"
          onClick={() => onChange(all)}
          disabled={disabled || allSelected}
          aria-pressed={allSelected}
          className={pill(allSelected)}
        >
          All
        </button>
        {interests.map((i) => {
          const on = active.has(i.topic);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => toggle(i.topic)}
              disabled={disabled}
              aria-pressed={on}
              className={pill(on)}
            >
              <span className="max-w-[16ch] truncate">{i.topic}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
