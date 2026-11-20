"use client";

import * as React from "react";
import { FeedView } from "@/components/FeedView";
import { formatDate } from "@/lib/format-date";
import type { Brief } from "@/lib/types";

type Props = {
  brief: Brief;
  name: string;
  // Header override. The current edition uses the owner label ("Your
  // brief" / "<name>'s brief"); historical editions in the pager pass
  // "Daily brief" so each past brief reads "Daily brief — <date>".
  heading?: string;
  // Bubble up when a single-story detail opens/closes. The page uses it
  // to hide its own siblings (banners, history pager); we use it to drop this
  // brief's "Your brief — <date>" header so the focused view is ONLY the story.
  onDetailOpenChange?: (open: boolean) => void;
  // The topic filter beside the heading (TopicFilter), when the page has one.
  filter?: React.ReactNode;
};

export function BriefLayout({
  brief,
  name,
  heading,
  onDetailOpenChange,
  filter,
}: Props) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const handleDetailOpenChange = React.useCallback(
    (open: boolean) => {
      setDetailOpen(open);
      onDetailOpenChange?.(open);
    },
    [onDetailOpenChange],
  );
  const dateLabel = formatDate(brief.generatedAt);

  // No owner name set ⇒ fall back to "Your brief" rather than rendering the
  // empty-possessive "'s brief". The possessive only reads
  // right when there's actually a name to own it.
  const trimmedName = name.trim();
  const ownerLabel = trimmedName ? `${trimmedName}'s brief` : "Your brief";
  const title =
    heading ?? (brief.kind === "weekly" ? "Weekly brief" : ownerLabel);

  // A bare header: the date with "Written by AI", then the title and the
  // topic filter. Run now and New topic live in the menu.
  return (
    <article
      aria-label={`${title} — ${dateLabel}`}
      className="flex flex-col gap-6"
    >
      {/* In single-story mode the brief header is part of "the feed"
          the reader doesn't want to see — the detail carries its own headline
          and meta. Hide it so only the story remains. */}
      {!detailOpen && (
        <header className="flex flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
            <span>{dateLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="rounded-pill border border-border-default px-2 py-0.5 text-caption text-secondary">
              Written by AI
            </span>
          </p>
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 text-title-1 text-primary [text-wrap:balance]">
              {title}
            </h1>
            {filter}
          </div>
        </header>
      )}

      <FeedView brief={brief} onDetailOpenChange={handleDetailOpenChange} />
    </article>
  );
}
