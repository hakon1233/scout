"use client";

import * as React from "react";

import { getLocalStorage, isClient, safeSetItem } from "@/lib/safe-storage";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "scout.theme";
// Same-tab broadcast so every mounted <ThemeToggle> stays in sync. The native
// `storage` event only fires in OTHER tabs, so two toggles in the SAME document
// (e.g. the settings page body control + the one in AppNav's profile menu, or the
// landing page's desktop/mobile pair) would otherwise show a stale selection /
// wrong `aria-checked` after one of them changes the theme (AIR-527).
const THEME_EVENT = "scout:theme-change";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark =
    isClient() && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", isDark);
}

function readStored(): Theme {
  const raw = getLocalStorage()?.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function ThemeToggle({
  showLabels = false,
}: { showLabels?: boolean } = {}) {
  const [theme, setThemeState] = React.useState<Theme>(() =>
    isClient() ? readStored() : "system",
  );
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    safeSetItem(STORAGE_KEY, next);
    // Notify sibling toggles mounted in THIS document (the `storage` event won't).
    if (isClient()) window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  // Keep every mounted toggle's highlight/aria-checked in sync when the theme is
  // changed elsewhere — another toggle in this tab (THEME_EVENT) or another tab
  // (native `storage`). Re-read the stored value AND re-apply it so the DOM class
  // and the highlight never disagree (a same-tab dispatcher already applied it;
  // a cross-tab change re-applies here, keeping this tab consistent).
  React.useEffect(() => {
    const sync = () => {
      const next = readStored();
      setThemeState(next);
      applyTheme(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) sync();
    };
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Order matches the founder ask: Light / Dark / System.
  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <SunIcon /> },
    { value: "dark", label: "Dark", icon: <MoonIcon /> },
    { value: "system", label: "System", icon: <SystemIcon /> },
  ];

  if (showLabels) {
    // Labeled segmented control for the settings panel (PER-189): full-width,
    // icon + text so the three choices read clearly inside the menu.
    return (
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-3 gap-1 rounded-md border border-border-default bg-surface p-1"
      >
        {options.map((opt) => {
          const active = mounted && theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              suppressHydrationWarning
              onClick={() => setTheme(opt.value)}
              className={
                "inline-flex flex-col items-center justify-center gap-1 rounded-sm px-2 py-2 text-caption transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page " +
                (active
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:bg-surface-muted hover:text-primary")
              }
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-1 rounded-pill border border-border-default bg-surface p-1"
    >
      {options.map((opt) => {
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            suppressHydrationWarning
            onClick={() => setTheme(opt.value)}
            className={
              "inline-flex size-8 items-center justify-center rounded-pill transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page " +
              (active
                ? "bg-accent text-accent-fg"
                : "text-muted hover:bg-surface-muted hover:text-primary")
            }
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/**
 * Blocking theme-resolution script. MUST be rendered inside <head>, before the
 * render-blocking stylesheet and before <body> is parsed, so the correct theme
 * class is on <html> at first paint — no flash of the light/warm-paper default
 * before the dark editorial theme settles (FOUC, PER-131). Also sets
 * color-scheme so UA surfaces (scrollbars, form controls) paint in the right
 * mode immediately.
 */
export function ThemeBootstrap() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var k='${STORAGE_KEY}',t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'&&t!=='system'){t='system';}var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
      }}
    />
  );
}
