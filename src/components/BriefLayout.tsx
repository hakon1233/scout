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
};

export function BriefLayout({
  brief,
  name,
  heading,
  onDetailOpenChange,
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

  // A deliberately bare header — title + date and NOTHING else. The
  // old "Generated … · time" caption and the "Searched N topics · X articles"
  // banner (whose counts were the source of the cosmetic counter bug) are gone,
  // so the reader drops straight from the title into the headlines. The inline
  // Run-now / Manage-interests footer card was removed too: Run-now now lives in
  // the top-right profile menu, and Manage interests lives in the history pager
  // at the bottom of the feed.
  return (
    <article
      aria-label={`${title} — ${dateLabel}`}
      className="flex flex-col gap-6"
    >
      {/* In single-story mode the brief header is part of "the feed"
          the reader doesn't want to see — the detail carries its own headline
          and meta. Hide it so only the story remains. */}
      {!detailOpen && (
        <header className="measure-prose flex flex-col gap-1">
          <h1 className="text-title-1 text-primary">
            {title} — {dateLabel}
          </h1>
        </header>
      )}

      <FeedView brief={brief} onDetailOpenChange={handleDetailOpenChange} />
    </article>
  );
}
