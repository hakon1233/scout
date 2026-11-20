"use client";

import Link from "next/link";
import * as React from "react";

// A topic's own push switch, as a small bell: on topic cards, followed topics,
// Browse results, the topic's page and the Settings list. Off by default.
// Greyed out while push is off on this device; a tap then says how to turn it
// on instead of doing nothing.
export function PushBell({
  topic,
  on,
  onChange,
  deviceOn,
}: {
  topic: string;
  on: boolean;
  onChange: (on: boolean) => void;
  deviceOn: boolean;
}) {
  const [hint, setHint] = React.useState(false);
  const label = `Notify me about ${topic}`;

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-pressed={deviceOn ? on : false}
        aria-disabled={!deviceOn || undefined}
        onClick={() => (deviceOn ? onChange(!on) : setHint((v) => !v))}
        onBlur={() => setHint(false)}
        className={[
          "inline-flex size-11 items-center justify-center rounded-full transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          !deviceOn
            ? "text-muted opacity-50"
            : on
              ? "text-primary"
              : "text-muted",
        ].join(" ")}
      >
        <BellIcon filled={deviceOn && on} />
      </button>
      {hint && (
        <span
          role="status"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-[14px] border border-border-default bg-surface p-3 text-caption text-secondary shadow-sm"
        >
          Turn on notifications for this device in{" "}
          <Link
            href="/app/settings/"
            className="font-medium text-primary underline"
            onMouseDown={(e) => e.preventDefault()}
          >
            Settings
          </Link>{" "}
          first.
        </span>
      )}
    </span>
  );
}

function BellIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
