"use client";

import * as React from "react";
import { Chip } from "@/components/ui";
import type { Interest } from "@/lib/types";

const MAX_INTERESTS = 6;

type Props = {
  interests: Interest[];
  onChange: (next: Interest[]) => void;
};

export function InterestChips({ interests, onChange }: Props) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function remove(id: string) {
    // Never let the list reach zero — the disabled remove button is the primary
    // guard; this is the defensive backstop.
    if (interests.length <= 1) return;
    onChange(interests.filter((i) => i.id !== id));
  }

  function commit() {
    const topic = draft.trim();
    if (!topic) {
      setAdding(false);
      setDraft("");
      return;
    }
    const exists = interests.some(
      (i) => i.topic.toLowerCase() === topic.toLowerCase(),
    );
    if (exists) {
      setDraft("");
      setAdding(false);
      return;
    }
    const next: Interest = {
      id: `int_${Date.now()}_${topic.slice(0, 12)}`,
      topic,
    };
    onChange([...interests, next]);
    setDraft("");
    setAdding(false);
  }

  function cancel() {
    setDraft("");
    setAdding(false);
  }

  const atMax = interests.length >= MAX_INTERESTS;
  // Keep at least one interest — an empty list dead-ends `generate()` (the
  // companion 400s on "interests required"). Mirrors SetupForm's min-1 rule.
  const atMin = interests.length <= 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label="Interests">
      {interests.map((i) => (
        <span key={i.id} role="listitem">
          <Chip
            onRemove={() => remove(i.id)}
            removeLabel={`Remove ${i.topic}`}
            removeDisabled={atMin}
            removeTitle={atMin ? "Keep at least one interest" : undefined}
          >
            {i.topic}
          </Chip>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1 rounded-pill border border-border-strong bg-surface px-2 py-0.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={commit}
            placeholder="New interest"
            aria-label="New interest"
            className="min-w-32 bg-transparent text-caption text-primary outline-none placeholder:text-muted"
            maxLength={64}
          />
        </span>
      ) : atMax ? (
        <span
          className="inline-flex items-center rounded-pill px-2 py-0.5 text-caption text-muted"
          role="note"
        >
          Max {MAX_INTERESTS} interests — remove one to add another
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-pill border border-dashed border-border-strong bg-surface px-2 py-0.5 text-caption text-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="Add interest"
        >
          <span aria-hidden="true">+</span> Add
        </button>
      )}
    </div>
  );
}
