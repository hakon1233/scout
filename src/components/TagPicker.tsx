"use client";

import * as React from "react";
import type { HostedData } from "@/lib/hosted";
import {
  popularTags,
  searchTags,
  toggleTag,
  type TagCount,
} from "@/lib/tag-picker";

// Picks tags: a public topic's (at most 5) and the profile's liked tags (at
// most 10). Picked tags and suggestions are one row of toggle chips; a search
// adds any tag, including one nobody has used yet. Saving is the caller's.

const CHIP =
  "inline-flex min-h-9 items-center rounded-pill border px-3 text-body-sm transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring " +
  "phone:min-h-11";

export function TagChip({
  tag,
  pressed,
  onClick,
  add = false,
}: {
  tag: string;
  pressed: boolean;
  onClick: () => void;
  /** A search match: shown as "+ tag". */
  add?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`${CHIP} ${
        pressed
          ? "border-primary bg-surface-muted font-medium text-primary"
          : "border-border-default bg-surface text-secondary hover:border-border-strong hover:text-primary"
      }`}
    >
      {add ? `+ ${tag}` : tag}
    </button>
  );
}

export function TagPicker({
  selected,
  onChange,
  counts,
  max,
  label,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  counts: readonly TagCount[];
  max: number;
  /** What the chips are, for screen readers ("Tags for …"). */
  label: string;
}) {
  const [query, setQuery] = React.useState("");
  const searchId = React.useId();
  const full = selected.length >= max;
  // Suggestions stay put while picking: picked ones first, then the most
  // used tags not picked, so a chip never jumps under the finger.
  const suggested = popularTags(counts, 12).filter(
    (t) => !selected.includes(t),
  );
  const shown = [...selected, ...suggested].slice(
    0,
    Math.max(selected.length, 10),
  );
  const { matches, free } = searchTags(query, { selected, counts, limit: 5 });
  const toggle = (tag: string) => onChange(toggleTag(selected, tag, max));

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {shown.map((tag) => (
          <TagChip
            key={tag}
            tag={tag}
            pressed={selected.includes(tag)}
            onClick={() => toggle(tag)}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search tags
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          disabled={full}
          placeholder={full ? `${max} is the most` : "Search tags"}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const pick = matches[0] ?? free;
            if (pick) {
              toggle(pick);
              setQuery("");
            }
          }}
          className="min-h-11 w-full rounded-[12px] border border-border-strong bg-surface px-3 text-base text-primary placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60 sm:text-body-sm"
        />
        {query.trim() && !full && (
          <div className="flex flex-wrap gap-2" aria-live="polite">
            {[...matches, ...(free ? [free] : [])].map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                add
                pressed={false}
                onClick={() => {
                  toggle(tag);
                  setQuery("");
                }}
              />
            ))}
            {matches.length === 0 && !free && (
              <p className="text-body-sm text-muted">
                Tags are 2 to 24 letters, digits or dashes.
              </p>
            )}
          </div>
        )}
      </div>
      <p className="text-caption text-muted tabular-nums">
        {selected.length} of {max} ·{" "}
        {full ? `${max} is the most` : "Tap to add or remove"}
      </p>
    </div>
  );
}

// --- the catalog's tag counts, fetched once per page -------------------------

let countsCache: Promise<TagCount[]> | null = null;

/** The catalog's tags with their topic counts; empty until loaded or offline. */
export function useTagCounts(
  data: Pick<HostedData, "tagCounts"> | null,
): TagCount[] {
  const [counts, setCounts] = React.useState<TagCount[]>([]);
  React.useEffect(() => {
    if (!data) return;
    countsCache ??= data.tagCounts().catch(() => {
      countsCache = null;
      return [];
    });
    let live = true;
    void countsCache.then((c) => live && setCounts(c));
    return () => {
      live = false;
    };
  }, [data]);
  return counts;
}
