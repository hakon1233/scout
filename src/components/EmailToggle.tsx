"use client";

// A topic's "Email me new briefs" switch, as a small envelope beside its bell:
// on the topic's page and in Settings. Off by default; each new brief for the
// topic then arrives by email. Shown only while email is switched on for
// Scout (useTopicEmail's `enabled`).
export function EmailToggle({
  topic,
  on,
  onChange,
}: {
  topic: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Email me new briefs about ${topic}`}
      aria-pressed={on}
      title="Email me new briefs"
      onClick={() => onChange(!on)}
      className={[
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        on ? "text-primary" : "text-muted",
      ].join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2"
          fill={on ? "currentColor" : "none"}
          fillOpacity={on ? 0.15 : 0}
        />
        <path d="m4 7 8 6 8-6" />
      </svg>
    </button>
  );
}
