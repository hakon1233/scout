"use client";

import Link from "next/link";

// Shared top nav for every `/app/*` route: the "← Scout" home link on the left
// and a persistent profile icon on the right. Clicking the icon takes the user
// to `/app/profile` — the chat-managed interest-docs view where they talk to
// Scout to manage what it tracks (PER-183).
//
// This was the founder's very first ask ("profile icon top-right so we can edit
// stuff"). It used to open a local in-page chip editor (PER-160), which left
// the real `/app/profile` page — chat + interest files — invisible: nothing
// linked to it. Now the icon is one persistent affordance that always lands on
// that page, on every `/app/*` route.
const ICON_CLASSES =
  "inline-flex size-9 items-center justify-center rounded-pill border border-border-default bg-surface text-muted transition hover:bg-surface-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page";

export function AppNav() {
  return (
    <nav className="flex items-center justify-between">
      <Link
        href="/"
        className="text-caption uppercase text-muted transition hover:text-primary"
      >
        ← Scout
      </Link>
      <Link
        href="/app/profile"
        aria-label="Open your profile"
        title="Profile & interests"
        className={ICON_CLASSES}
      >
        <ProfileIcon />
      </Link>
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
