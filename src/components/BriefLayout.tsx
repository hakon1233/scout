"use client";

import * as React from "react";
import { FeedView } from "@/components/FeedView";
import type { Brief } from "@/lib/types";

type Props = {
  brief: Brief;
  name: string;
  // PER-219: header override. The current edition uses the owner label ("Your
  // brief" / "<name>'s brief"); historical editions in the pager pass
  // "Daily brief" so each past brief reads "Daily brief — <date>".
  heading?: string;
};

export function BriefLayout({ brief, name, heading }: Props) {
  const generated = new Date(brief.generatedAt);
  const dateLabel = generated.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // No founder name set ⇒ fall back to "Your brief" rather than rendering the
  // empty-possessive "'s brief" (PER-186 defect 2). The possessive only reads
  // right when there's actually a name to own it.
  const trimmedName = name.trim();
  const ownerLabel = trimmedName ? `${trimmedName}'s brief` : "Your brief";
  const title = heading ?? ownerLabel;

  // PER-219: a deliberately bare header — title + date and NOTHING else. The
  // old "Generated … · time" caption and the "Searched N topics · X articles"
  // banner (whose counts were the source of the cosmetic counter bug) are gone,
  // so the reader drops straight from the title into the headlines. The inline
  // Run-now / Manage-interests footer card was removed too: Run-now now lives in
  // the top-right profile menu, and Manage interests lives in the history pager
  // at the bottom of the feed.
  return (
    <article aria-label={`${title} — ${dateLabel}`} className="flex flex-col gap-6">
      <header className="measure-prose flex flex-col gap-1">
        <h1 className="text-title-1 text-primary">
          {title} — {dateLabel}
        </h1>
      </header>

      <FeedView brief={brief} />
    </article>
  );
}
