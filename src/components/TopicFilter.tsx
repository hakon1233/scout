"use client";

import * as React from "react";
import { useDisclosure } from "@/hooks/useDisclosure";

// The feed's topic picker beside the "Your brief" heading: "All topics ▾" or
// the chosen topic. Read-only and client-side; it never changes saved topics.
export function TopicFilter({
  topics,
  activeFilter,
  onFilterChange,
}: {
  topics: { id: string; topic: string }[];
  activeFilter: string | null;
  onFilterChange: (topic: string | null) => void;
}) {
  const { open, setOpen, containerRef, buttonRef } = useDisclosure();
  const isFiltered = activeFilter !== null;

  function select(topic: string | null) {
    onFilterChange(topic);
    setOpen(false);
  }

  const option = (key: string, label: string, value: string | null) => {
    const on = activeFilter === value;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => select(value)}
        className={[
          "flex min-h-10 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-body-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          on
            ? "bg-surface-muted text-primary"
            : "text-primary hover:bg-surface-muted/70",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {on && (
          <span className="shrink-0" aria-hidden="true">
            ✓
          </span>
        )}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={isFiltered ? `Filtering by ${activeFilter}` : "Filter feed"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={[
          "inline-flex min-h-11 max-w-[11rem] items-center gap-1 rounded-pill px-3 text-body-sm font-medium transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          isFiltered ? "text-primary" : "text-secondary",
        ].join(" ")}
      >
        <span className="truncate">{activeFilter ?? "All topics"}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          role="group"
          aria-labelledby="feed-filter-heading"
          className="absolute right-0 top-full z-30 mt-1 glass glass-strong flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-[18px] p-2"
        >
          <p
            id="feed-filter-heading"
            className="px-3 py-1 text-caption text-muted"
          >
            Filter by topic
          </p>
          {option("all", "All topics", null)}
          {topics.map((t) => option(t.id, t.topic, t.topic))}
        </div>
      )}
    </div>
  );
}
