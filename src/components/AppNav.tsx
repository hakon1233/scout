"use client";

import Link from "next/link";
import * as React from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

// Shared top nav for every `/app/*` route. Left: the Scout wordmark (logo slot +
// home link). Right: the profile menu, which owns theme controls, a Run-now
// action, and navigation to the split Settings / Chat / Interests pages.
const ICON_CLASSES =
  "inline-flex size-9 items-center justify-center rounded-pill border border-border-default bg-surface text-muted transition hover:bg-surface-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page";

export function AppNav({
  // PER-219 (AC3): Run-now moved off the feed body into the profile menu. The
  // feed page passes its existing run-now wiring (a full, persisting run over the
  // saved interest list — never ephemeral, never mutating the saved set). Omitted
  // on routes that have no brief to run (Settings/Chat/etc.), where the menu
  // simply doesn't show the action.
  onRunNow,
  running = false,
}: {
  onRunNow?: () => void;
  running?: boolean;
} = {}) {
  return (
    <nav className="flex items-center justify-between">
      <ScoutWordmark />
      <ProfileMenu onRunNow={onRunNow} running={running} />
    </nav>
  );
}

// PER-225: the chosen logo — concept #2 "Trail Monogram" — in the top-left logo
// slot PER-219 reserved. The mark is the founder-picked Trail Monogram badge:
// an "S" drawn as a scouting trail ending in a signal-red node (#9a3b2e, the
// brand Direction-A signal red). It's inlined as pure SVG paths, so it carries
// no font dependency and renders identically everywhere. The badge is a fixed-
// colour app-icon tile (same mark as the favicon), paired with the live Fraunces
// "Scout" wordmark — identical to every masthead/title in the editorial UI, so
// it stays theme-adaptive (light/dark) and consistent with the rest of the type.
// Doubles as the home link (back to the feed) from any /app/* route.
function ScoutWordmark() {
  return (
    <Link
      href="/app/"
      aria-label="Scout — home"
      className="group inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
    >
      <TrailMonogram />
      <span className="font-serif text-title-3 leading-none text-primary">
        Scout
      </span>
    </Link>
  );
}

// Trail Monogram mark (concept #2). Pure SVG, fixed app-icon colours so it reads
// as the same tile in the header and the browser tab: ink badge, cream trail,
// signal-red node. 28px in the header slot — crisp at desktop 1440 and mobile
// 390, no overflow, vertically centred by the flex row.
function TrailMonogram() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="size-7 shrink-0 transition group-hover:scale-105"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="60" height="60" rx="15" fill="#1c1a17" />
      <path
        d="M43 23 C43 16 22 15 22 25 C22 34 42 32 42 41 C42 51 21 50 21 42"
        fill="none"
        stroke="#f6f2ea"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <circle cx="43" cy="23" r="4.5" fill="#9a3b2e" />
    </svg>
  );
}

function ProfileMenu({
  onRunNow,
  running = false,
}: {
  onRunNow?: () => void;
  running?: boolean;
}) {
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
    <div ref={containerRef} className="relative ml-auto">
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
          {/* PER-219 (AC3): Run-now lives here now. Fires the feed's full,
              persisting run over the saved interest list — the saved interests
              are never altered by running. Hidden on routes that pass no handler. */}
          {onRunNow && (
            <div className="mb-3">
              <button
                type="button"
                role="menuitem"
                disabled={running}
                onClick={() => {
                  setOpen(false);
                  onRunNow();
                }}
                className="flex w-full items-center justify-between rounded-md border border-border-strong bg-surface-strong px-3 py-2 text-body-sm font-medium text-primary transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{running ? "Working…" : "Run now"}</span>
                <span aria-hidden="true">↻</span>
              </button>
            </div>
          )}

          <div className="mb-3">
            <p className="mb-2 font-mono text-caption uppercase tracking-[0.06em] text-muted">
              Theme
            </p>
            <ThemeToggle showLabels />
          </div>

          <div className="border-t border-border-default pt-3">
            <MenuLink href="/app/settings" onSelect={() => setOpen(false)}>
              Settings
            </MenuLink>
            <MenuLink href="/app/interests" onSelect={() => setOpen(false)}>
              Interests &amp; chat
            </MenuLink>
            <MenuLink href="/app/skills" onSelect={() => setOpen(false)}>
              Skills
            </MenuLink>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  onSelect,
  children,
}: {
  href: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="mb-2 flex w-full items-center justify-between rounded-md border border-border-default bg-surface px-3 py-2 text-body-sm font-medium text-primary transition last:mb-0 hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page"
    >
      <span>{children}</span>
      <span aria-hidden="true">→</span>
    </Link>
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
