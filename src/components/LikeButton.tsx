"use client";

import * as React from "react";
import {
  likeKey,
  toggleLike,
  toggleSave,
  useIsLiked,
  useIsSaved,
  type LikeInput,
} from "@/lib/likes";

// The per-story like and save controls. The heart sits on every feed card, in
// the single-story detail and in the Liked feed (where it unlikes); the
// bookmark (save for later) sits beside it in the detail. Both are real
// <button>s with `aria-pressed`, so they announce as toggles; the fill and the
// editorial signal colour carry the state visually.
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
      title={liked ? "Liked. Tap to remove" : "Like"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleLike(story);
      }}
      className={markClasses(liked, className)}
    >
      <HeartIcon filled={liked} />
    </button>
  );
}

/** Save for later: the story's bookmark, beside the heart in its detail. */
export function SaveButton({
  story,
  className = "",
}: {
  story: LikeInput;
  className?: string;
}) {
  const saved = useIsSaved(likeKey(story.url));
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save for later"}
      title={saved ? "Saved. Tap to remove" : "Save for later"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleSave(story);
      }}
      className={markClasses(saved, className)}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[18px]"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.5 3.75h11a.75.75 0 0 1 .75.75v15.6l-6.25-4.2-6.25 4.2V4.5a.75.75 0 0 1 .75-.75z" />
      </svg>
    </button>
  );
}

function markClasses(on: boolean, className: string) {
  return [
    "inline-flex size-11 shrink-0 items-center justify-center rounded-pill border bg-surface/90 backdrop-blur transition sm:size-9 pointer-coarse:size-11",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page",
    on
      ? "border-signal text-signal hover:bg-surface-muted"
      : "border-border-default text-muted hover:border-border-strong hover:text-primary",
    className,
  ].join(" ");
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
