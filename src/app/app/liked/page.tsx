"use client";

import * as React from "react";
import Image from "next/image";
import { AppNav } from "@/components/AppNav";
import { LikeButton } from "@/components/LikeButton";
import { FeedImage, faviconFor, formatDate } from "@/components/FeedView";
import { EmptyState } from "@/components/ui";
import { useLikedStories, type LikedStory } from "@/lib/likes";

// PER-249: the dedicated "Liked" feed — every story the reader saved, newest
// first. Reached from the top-bar heart (CEO-locked entry point). A real static
// export route (`/app/liked/`), same shape as /app/interests/.
//
// This view is 100% device-local: it reads `scout.likes.v1` from localStorage
// via useLikedStories and makes NO network calls — consistent with the
// like store, which by construction can never touch any companion endpoint.
//
// Each card stores a display snapshot taken at like-time, so liked stories keep
// rendering long after they've aged out of the cached briefs. Tapping a card
// opens the original article at its source (we don't snapshot the long-form
// body); the heart unlikes in place.
export default function LikedPage() {
  // useLikedStories is backed by useSyncExternalStore with an empty
  // getServerSnapshot, so the export/SSR render and the first hydration render
  // both see an empty list (matching markup, no hydration mismatch); React then
  // re-renders with the real localStorage snapshot. No mount gate needed.
  const stories = useLikedStories();

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-primary sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <AppNav />

        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-title-1 leading-tight text-primary">
            Liked stories
          </h1>
          <p className="font-reading text-body-sm text-muted">
            Stories you saved, newest first. Saved on this device.
          </p>
        </header>

        {stories.length === 0 ? (
          <LikedEmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2">
            {stories.map((s) => (
              <LikedCard key={s.key} story={s} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// Uses the shared EmptyState primitive (src/components/ui/EmptyState.tsx)
// instead of a hand-rolled card, so this stays in sync with every other
// "nothing here yet" surface in the app.
function LikedEmptyState() {
  return (
    <EmptyState
      icon={
        <svg
          viewBox="0 0 24 24"
          className="size-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20.25l-7.1-7.02a4.5 4.5 0 0 1 6.36-6.36L12 7.6l.74-.73a4.5 4.5 0 1 1 6.36 6.36L12 20.25z" />
        </svg>
      }
      title="No liked stories yet"
      body="Tap the heart on any story to save it here. Your liked stories stay on this device and survive new daily briefs."
    />
  );
}

function LikedCard({ story }: { story: LikedStory }) {
  // Same two-sibling pattern as FeedView's FeedCard: a full-area link (opens the
  // source) plus the heart overlaid top-right (unlikes). The wrapper owns the
  // shared frame so both controls live in one card.
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-md border border-border-default bg-surface transition focus-within:ring-2 focus-within:ring-focus-ring hover:border-border-strong hover:bg-surface-muted">
      <a
        href={story.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-full flex-col focus:outline-none"
      >
        {story.imageUrl && (
          <FeedImage
            src={story.imageUrl}
            className="aspect-[16/9] w-full object-cover"
          />
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption uppercase tracking-wide text-muted">
            <span className="font-medium text-signal">{story.topic}</span>
            {story.publishedAt && (
              <span className="tabular-nums">
                · {formatDate(story.publishedAt)}
              </span>
            )}
          </div>
          <h2 className="font-serif text-title-3 leading-snug text-primary line-clamp-3">
            {story.headline}
          </h2>
          {story.blurb && (
            <p className="font-reading text-body-sm text-secondary line-clamp-2">
              {story.blurb}
            </p>
          )}
          <span className="mt-auto flex items-center gap-2 pr-11 pt-1 text-caption text-muted">
            <Image
              src={faviconFor(story.source)}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 rounded-sm"
              loading="lazy"
            />
            {story.source} ↗
          </span>
        </div>
      </a>
      <LikeButton story={story} className="absolute right-2 top-2" />
    </div>
  );
}
