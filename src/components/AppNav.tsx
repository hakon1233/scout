"use client";

import Link from "next/link";
import * as React from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

// Shared top nav for every `/app/*` route: the "← Scout" home link on the left
// and a persistent profile icon on the right. Clicking the icon opens a small
// settings panel (PER-189) with two controls, in order:
//   1. Theme — Dark / Light / System (System follows the OS prefers-color-scheme).
//   2. "Manage interests" — navigates to /app/profile, the chat-managed
//      interest-docs view (single destination, coordinated with PER-188).
//
// History: the icon first opened a local in-page chip editor (PER-160), then
// PER-183 made it a one-click jump straight to /app/profile. PER-189 changes it
// again to this settings panel so theme + interests live behind one affordance.
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
      <ProfileMenu />
    </nav>
  );
}

function ProfileMenu() {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click or Escape while open.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Open settings"
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={ICON_CLASSES}
      >
        <ProfileIcon />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Settings"
          className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border-default bg-surface p-3 shadow-lg"
        >
          <div className="mb-3">
            <p className="mb-2 font-mono text-caption uppercase tracking-[0.06em] text-muted">
              Theme
            </p>
            <ThemeToggle showLabels />
          </div>

          <div className="border-t border-border-default pt-3">
            <Link
              href="/app/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-between rounded-md border border-border-strong bg-surface px-3 py-2 text-body-sm font-medium text-primary transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page"
            >
              <span>Manage interests</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
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
