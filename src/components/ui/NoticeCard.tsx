import * as React from "react";

type Tone = "bad" | "new" | "neutral";

const toneText: Record<Tone, string> = {
  bad: "text-danger",
  new: "text-signal-deep",
  neutral: "text-muted",
};

type Props = {
  /** Short kind label above the text, e.g. "Run failed". */
  label?: string;
  tone?: Tone;
  /** A second fact beside the label, e.g. the date. */
  meta?: string;
  children: React.ReactNode;
  /** One small action (a Button or Link with size sm). */
  action?: React.ReactNode;
  /** Shows the X. The card's owner removes it. */
  onDismiss?: () => void;
  /** Accessible name for the X, e.g. "Dismiss notice about Markets". */
  dismissLabel?: string;
  className?: string;
};

// One card for everything Scout tells the reader on the feed: notices (a run
// failed, a topic stopped), weekly suggestions and the Home Screen tip. A solid
// surface, not glass: it is content, not floating chrome.
export function NoticeCard({
  label,
  tone = "neutral",
  meta,
  children,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  className = "",
}: Props) {
  return (
    <div
      className={`relative flex flex-col gap-2 rounded-card border border-border-default bg-surface p-4 ${onDismiss ? "pr-12" : ""} ${className}`}
    >
      {(label || meta) && (
        <p className="text-caption">
          {label && (
            <span className={`font-medium ${toneText[tone]}`}>{label}</span>
          )}
          {label && meta && <span className="text-muted"> · </span>}
          {meta && <span className="text-muted">{meta}</span>}
        </p>
      )}
      <div className="min-w-0 break-words text-body-sm text-primary">
        {children}
      </div>
      {action && <div className="flex flex-wrap gap-2 pt-1">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="absolute right-1 top-1 inline-flex size-11 items-center justify-center rounded-full text-muted transition hover:bg-surface-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
