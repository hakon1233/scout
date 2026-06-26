"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Per-route browser-tab / document titles for the in-app (/app/*) routes.
//
// Every /app route is a "use client" component, so none of them can export
// Next's static `metadata`; without this the root layout's single static
// <title> ("Scout — Personalized AI news…") is the announced document title
// on *every* in-app screen. That fails WCAG 2.4.2 (Page Titled): two open
// tabs are indistinguishable, history/bookmarks are undifferentiated, and a
// screen reader announces the same title on each client-side navigation.
//
// This layout wraps the route tree and sets `document.title` from the current
// pathname after navigation. Labels mirror the in-app nav wording. Reversible:
// delete this file to restore the prior single-title behavior.

const SUFFIX = "Scout";

// Longest-prefix match so nested routes (e.g. /app/profile/interest) resolve
// to the most specific label. Keys are normalized: no basePath, no trailing
// slash. Order is most-specific-first.
const ROUTE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["/app/profile/interest", "Interest"],
  ["/app/interests/interest", "Interest"],
  ["/app/connect", "Connect companion"],
  ["/app/settings", "Settings"],
  ["/app/interests", "Interests"],
  ["/app/profile", "Profile"],
  ["/app/skills", "Skills"],
  ["/app/liked", "Liked stories"],
  ["/app/chat", "Chat"],
  ["/app", "Brief"],
];

function labelForPath(pathname: string): string | null {
  // Strip trailing slash (trailingSlash: true) but keep the root "/app".
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  for (const [prefix, label] of ROUTE_TITLES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return label;
    }
  }
  return null;
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    const label = labelForPath(pathname);
    document.title = label ? `${label} · ${SUFFIX}` : SUFFIX;
  }, [pathname]);

  return <>{children}</>;
}
