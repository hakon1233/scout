"use client";

import Link from "next/link";

// Shared top nav for every `/app/*` route (PER-160): the "← Scout" home link on
// the left and a persistent profile icon on the right. Clicking the icon opens
// the profile/edit view where the user manages their interests.
//
// On the main app page we have the editor in local state, so the host passes
// `onOpenProfile` and we render a <button>. On other `/app/*` routes (e.g.
// /app/connect) there's no in-page editor, so we omit the handler and render a
// <Link> to `/app/?profile=1` — the app page reads that query param on load and
// opens the editor. Either way the icon looks and sits in the same place, so it
// reads as one persistent affordance across routes.
const ICON_CLASSES =
  "inline-flex size-9 items-center justify-center rounded-pill border border-border-default bg-surface text-muted transition hover:bg-surface-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page";

export function AppNav({ onOpenProfile }: { onOpenProfile?: () => void }) {
  return (
    <nav className="flex items-center justify-between">
      <Link
        href="/"
        className="text-caption uppercase text-muted transition hover:text-primary"
      >
        ← Scout
      </Link>
      {onOpenProfile ? (
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Open your profile"
          title="Profile & interests"
          className={ICON_CLASSES}
        >
          <ProfileIcon />
        </button>
      ) : (
        <Link
          href="/app/?profile=1"
          aria-label="Open your profile"
          title="Profile & interests"
          className={ICON_CLASSES}
        >
          <ProfileIcon />
        </Link>
      )}
    </nav>
  );
}

function ProfileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
