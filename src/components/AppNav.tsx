"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

// Shared top nav for every `/app/*` route. The profile menu owns direct theme
// controls plus navigation to the split Settings / Chat / Interests pages.
const ICON_CLASSES =
  "inline-flex size-9 items-center justify-center rounded-pill border border-border-default bg-surface text-muted transition hover:bg-surface-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page";

export function AppNav() {
  const pathname = usePathname();
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const showBackLink = normalizedPathname !== "/app";

  return (
    <nav className="flex items-center justify-between">
      {showBackLink ? (
        <Link
          href="/app/"
          className="text-caption uppercase text-muted transition hover:text-primary"
        >
          ← Scout
        </Link>
      ) : null}
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
            <MenuLink href="/app/chat" onSelect={() => setOpen(false)}>
              Chat
            </MenuLink>
            <MenuLink href="/app/interests" onSelect={() => setOpen(false)}>
              Interests
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
