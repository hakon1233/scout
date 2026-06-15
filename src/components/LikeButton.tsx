"use client";

import * as React from "react";
import { likeKey, toggleLike, useIsLiked, type LikeInput } from "@/lib/likes";

// PER-249: the per-story like/save control. Used on every feed card, in the
// single-story detail, and in the Liked feed itself (where it unlikes). It's a
// real <button> with `aria-pressed` so it announces as a toggle to screen
// readers; the heart fill + editorial signal colour carry the state visually.
//
// stopPropagation/preventDefault: on the feed card this button is a SIBLING of
// the open-detail button (not nested), but on other surfaces it may sit inside a
// link/clickable region, so we defensively stop the click from bubbling into a
// parent navigation.

export function LikeButton({
  story,
  className = "",
}: {
  story: LikeInput;
  className?: string;
}) {
  const liked = useIsLiked(likeKey(story.url));

  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? "Remove from liked stories" : "Save to liked stories"}
      title={liked ? "Saved — tap to remove" : "Save to liked"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleLike(story);
      }}
      className={[
        "inline-flex size-9 shrink-0 items-center justify-center rounded-pill border bg-surface/90 backdrop-blur transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page",
        liked
          ? "border-signal text-signal hover:bg-surface-muted"
          : "border-border-default text-muted hover:border-border-strong hover:text-primary",
        className,
      ].join(" ")}
    >
      <HeartIcon filled={liked} />
    </button>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[18px]"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.25l-7.1-7.02a4.5 4.5 0 0 1 6.36-6.36L12 7.6l.74-.73a4.5 4.5 0 1 1 6.36 6.36L12 20.25z" />
    </svg>
  );
}
