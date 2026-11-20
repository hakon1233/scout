"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useDisclosure } from "@/hooks/useDisclosure";
import { isHostedBuild } from "@/lib/auth";
import { planFor } from "@/lib/plans";

// The app's frame on every /app/* screen: a floating glass logo pill at the
// top left (home) and a round glass menu button at the top right, over a plain
// page. No full-width bar and no bottom tabs. The page column is 680px wide.

/** Where "New topic" goes: the setup chat. */
export function newTopicHref(): string {
  return isHostedBuild() ? "/app/topics/?new=1" : "/app/interests/";
}

export type MenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

export type ShellMenu = {
  /** The reader's own topics, shown beside "Topics" when known. */
  topicCount?: number;
  /** The plan name the database reports ("free", "plus"). Hosted only. */
  plan?: string;
  /** Extra actions for this screen (the companion's Run now, Weekly brief). */
  actions?: MenuAction[];
};

export function AppShell({
  children,
  menu,
  width = "column",
}: {
  children: React.ReactNode;
  menu?: ShellMenu;
  /** "column" is the 680px reading column; "full" leaves layout to the page. */
  width?: "column" | "full";
}) {
  if (width === "full") {
    return (
      <>
        <TopPills menu={menu} />
        {children}
      </>
    );
  }
  return (
    <>
      <TopPills menu={menu} />
      <main className="min-h-screen bg-page px-4 pb-16 pt-[72px] text-primary sm:px-6 sm:pt-[88px]">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
          {children}
        </div>
      </main>
    </>
  );
}

/** A page's one header: an optional back link, the title and one action. */
export function PageHeader({
  title,
  back,
  action,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
  /** One quiet line under the title. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 mb-1 self-start rounded px-1 text-body-sm text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ‹ {back.label}
        </Link>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 font-serif text-title-1 text-primary [text-wrap:balance]">
          {title}
        </h1>
        {action}
      </div>
      {children && (
        <p className="text-body-sm text-secondary text-pretty">{children}</p>
      )}
    </header>
  );
}

/** The two floating pills. Pages with their own layout render only these. */
export function TopPills({ menu }: { menu?: ShellMenu }) {
  return (
    <>
      <div className="fixed left-3 top-3 z-40 sm:left-5 sm:top-4">
        <ScoutWordmark />
      </div>
      <div className="fixed right-3 top-3 z-40 sm:right-5 sm:top-4">
        <AppMenu menu={menu} />
      </div>
    </>
  );
}

/** The logo pill: the Scout mark and name, linking home. */
export function ScoutWordmark() {
  return (
    <Link
      href="/app/"
      aria-label="Scout home"
      className="glass inline-flex h-11 items-center gap-2 rounded-[22px] pl-[9px] pr-4 transition-transform active:scale-[0.98]"
    >
      <TrailMonogram />
      <span className="font-serif text-title-3 leading-none text-primary">
        Scout
      </span>
    </Link>
  );
}

// The Trail Monogram: an "S" drawn as a trail ending in a signal-red node. Fixed
// app-icon colours so it matches the favicon in both themes.
function TrailMonogram() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="size-7 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="31" fill="#1c1a17" />
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

const ROW =
  "flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-body-sm font-medium text-primary transition hover:bg-surface-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-60";

function AppMenu({ menu }: { menu?: ShellMenu }) {
  const { open, setOpen, containerRef, buttonRef } = useDisclosure();
  const pathname = usePathname() ?? "";
  const hosted = isHostedBuild();
  const plan = planFor(menu?.plan);
  const close = () => setOpen(false);

  const links: { href: string; label: string; count?: number }[] = [
    { href: "/app/topics/", label: "Topics", count: menu?.topicCount },
    { href: "/app/browse/", label: "Browse" },
    { href: "/app/settings/", label: "Settings" },
  ];
  const here = (href: string) =>
    pathname.replace(/\/$/, "") === href.replace(/\/$/, "");

  return (
    <div ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="app-menu"
        onClick={() => setOpen((v) => !v)}
        className="glass inline-flex size-11 items-center justify-center rounded-full text-primary transition-transform active:scale-[0.96]"
      >
        <MenuIcon open={open} />
      </button>

      {open && (
        <nav
          id="app-menu"
          aria-label="Menu"
          className="glass glass-strong fixed right-3 top-16 flex w-[min(320px,calc(100%-20px))] flex-col gap-0.5 rounded-[22px] p-2 sm:right-5 sm:top-[72px]"
        >
          <Link
            href="/app/profile/"
            onClick={close}
            aria-current={here("/app/profile/") ? "page" : undefined}
            className={`${ROW} min-h-14`}
          >
            <span
              aria-hidden="true"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-strong text-secondary"
            >
              <PersonIcon />
            </span>
            <span className="flex-1">Profile</span>
            <Chevron />
          </Link>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={close}
              aria-current={here(l.href) ? "page" : undefined}
              className={`${ROW} ${here(l.href) ? "bg-surface-muted/70" : ""}`}
            >
              <span className="flex-1">{l.label}</span>
              {l.count !== undefined && (
                <span className="tabular-nums text-muted">{l.count}</span>
              )}
            </Link>
          ))}

          {menu?.actions && menu.actions.length > 0 && (
            <>
              <hr className="mx-3 my-1 border-border-default" />
              {menu.actions.map((a, i) => (
                <button
                  key={`${i}`}
                  type="button"
                  disabled={a.disabled}
                  onClick={() => {
                    close();
                    a.onSelect();
                  }}
                  className={ROW}
                >
                  {a.label}
                </button>
              ))}
            </>
          )}

          <hr className="mx-3 my-1 border-border-default" />
          {hosted && (
            <div className="flex min-h-11 items-center gap-3 px-3 text-body-sm">
              <span className="flex-1 text-secondary">{plan.name} plan</span>
              {plan.id === "free" && (
                <Link
                  href="/app/upgrade/"
                  onClick={close}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Upgrade
                </Link>
              )}
            </div>
          )}
          <Link
            href={newTopicHref()}
            onClick={close}
            className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-accent px-4 text-body-sm font-medium text-accent-fg transition hover:bg-accent-hover"
          >
            <span aria-hidden="true">+</span> New topic
          </Link>
        </nav>
      )}
    </div>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

function Chevron() {
  return (
    <span aria-hidden="true" className="text-muted">
      ›
    </span>
  );
}
