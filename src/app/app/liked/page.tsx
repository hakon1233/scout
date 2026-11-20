"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { LikeButton, SaveButton } from "@/components/LikeButton";
import { FeedImage, SourceBadge, formatDate } from "@/components/FeedView";
import { EmptyState } from "@/components/ui";
import { useLikedStories, useSavedStories, type LikedStory } from "@/lib/likes";

// Liked and saved stories, newest first, as two tabs: Liked (the heart) and
// Saved (the bookmark, read later). The tab lives in the URL (?tab=saved).
//
// Both lists render from the device's stores (likes.ts): a snapshot taken at
// like or save time, so a story keeps showing long after it has aged out of
// the cached briefs. Signed in on hosted Scout the stores mirror the account
// (story_marks); the companion build never sends them anywhere. Tapping a card
// opens the original article; the heart or bookmark removes it in place.
export default function LikedPage() {
  return (
    <AppShell>
      <PageHeader
        title="Liked and saved"
        back={{ href: "/app/profile/", label: "Profile" }}
      />
      <React.Suspense fallback={null}>
        <Lists />
      </React.Suspense>
    </AppShell>
  );
}

function Lists() {
  const tab = useSearchParams().get("tab") === "saved" ? "saved" : "liked";
  // Both hooks read localStorage through useSyncExternalStore with an empty
  // server snapshot, so the export and the first hydration render match.
  const liked = useLikedStories();
  const saved = useSavedStories();
  const stories = tab === "saved" ? saved : liked;

  return (
    <>
      <nav
        aria-label="Liked or saved"
        className="-mt-2 flex gap-6 border-b border-border-default"
      >
        <TabLink href="/app/liked/" current={tab === "liked"}>
          Liked
        </TabLink>
        <TabLink href="/app/liked/?tab=saved" current={tab === "saved"}>
          Saved
        </TabLink>
      </nav>
      <div data-main>
        {stories.length === 0 ? (
          <Empty tab={tab} />
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2">
            {stories.map((s) => (
              <StoryCard key={s.key} story={s} tab={tab} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TabLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      replace
      scroll={false}
      aria-current={current ? "page" : undefined}
      className={`-mb-px inline-flex min-h-11 min-w-11 items-center justify-center border-b-2 text-body-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
        current
          ? "border-primary font-medium text-primary"
          : "border-transparent text-muted hover:text-primary"
      }`}
    >
      {children}
    </Link>
  );
}

function Empty({ tab }: { tab: "liked" | "saved" }) {
  return tab === "saved" ? (
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
          <path d="M6.5 3.75h11a.75.75 0 0 1 .75.75v15.6l-6.25-4.2-6.25 4.2V4.5a.75.75 0 0 1 .75-.75z" />
        </svg>
      }
      title="Nothing saved yet"
      body="Open a story and tap the bookmark to read it later. It stays here after new briefs come in."
    />
  ) : (
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
      body="Tap the heart on any story to keep it here. Liked stories survive new daily briefs."
    />
  );
}

function StoryCard({
  story,
  tab,
}: {
  story: LikedStory;
  tab: "liked" | "saved";
}) {
  // Same two-sibling pattern as FeedView's FeedCard: a full-area link (opens the
  // source) plus the mark overlaid top-right (removes it).
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-md border border-border-default bg-surface transition focus-within:ring-2 focus-within:ring-focus-ring hover:border-border-strong hover:bg-surface-muted">
      <a
        href={story.url}
        target="_blank"
        rel="nofollow ugc noopener"
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
            <SourceBadge host={story.source} />
            {story.source} ↗
          </span>
        </div>
      </a>
      {tab === "saved" ? (
        <SaveButton story={story} className="absolute right-2 top-2" />
      ) : (
        <LikeButton story={story} className="absolute right-2 top-2" />
      )}
    </div>
  );
}
