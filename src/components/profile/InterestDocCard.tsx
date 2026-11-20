"use client";

import { useState } from "react";
import { formatDocDate } from "@/lib/format-date";
import { DOC_CARD_MARKDOWN } from "./DocMarkdown";
import { LazyMarkdown } from "./LazyMarkdown";

// The "just changed" beat fired the instant a chat turn confirms a durable
// write to this interest's doc. It is the no-dead-control proof: the
// conversation visibly moves the card, and only on a confirmed write — never
// optimistically. `created` for a brand-new interest, `updated` for a refine,
// `removed` for the brief flash a confirmed delete plays before the card leaves
// the rail.
export type DocBeat = "created" | "updated" | "removed" | null;

// One interest's doc card. `body` is the markdown the companion persisted,
// known only when a chat turn returned it this session (there is no GET-doc
// route — by design we render what `changes[]` gave us). A pre-existing doc we
// haven't seen the body of still reads as "has a doc", just without a preview.
export type DocCardModel = {
  key: string;
  topic: string;
  hasDoc: boolean;
  updatedAt?: string;
  body?: string;
  beat: DocBeat;
  href: string;
};

export function InterestDocCard({
  model,
  focused,
  onFocusToggle,
  onOpen,
}: {
  model: DocCardModel;
  focused: boolean;
  onFocusToggle: () => void;
  // When provided, opening the card stays in-page (the
  // workbench swaps its left pane to the scope view, chat stays mounted on
  // the right) instead of navigating away and losing the chat. `href` is
  // kept on the title anchor so middle-click/new-tab still deep-links.
  onOpen?: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const { topic, hasDoc, updatedAt, body, beat, href } = model;

  const open = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    window.location.assign(href);
  };

  return (
    <article
      className={[
        "cursor-pointer rounded-lg border bg-surface p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        focused
          ? "border-signal"
          : "border-border-default hover:border-border-strong",
        // An unmistakable card-level flash the instant a turn
        // confirms a durable write. The dateline pill (below) names what
        // changed; this ring/tint sweep makes the moved card impossible to miss.
        beat ? "scout-doc-flash" : "",
      ].join(" ")}
      aria-label={`Topic: ${topic}`}
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button")) return;
        open();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        open();
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={href}
            onClick={(event) => {
              if (!onOpen) return;
              // Plain left-click opens in-page; modified clicks (new tab,
              // middle click) keep native anchor behavior via `href`.
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onOpen();
            }}
            className="block truncate font-serif text-title-3 leading-tight text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {topic}
          </a>
          <DocLine hasDoc={hasDoc} updatedAt={updatedAt} beat={beat} />
        </div>
        <button
          type="button"
          onClick={onFocusToggle}
          aria-pressed={focused}
          className={[
            "shrink-0 rounded-pill border px-2.5 py-1 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            focused
              ? "border-signal bg-signal/10 text-signal"
              : "border-border-default text-secondary hover:border-border-strong",
          ].join(" ")}
        >
          {focused ? "Editing" : "Refine"}
        </button>
      </header>

      {/* Body: render what the companion actually persisted. */}
      {body ? (
        <div className="mt-3 border-t border-border-default pt-3">
          {showRaw ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 font-mono text-body-sm leading-relaxed text-secondary">
              {body}
            </pre>
          ) : (
            <div className="scout-md max-h-64 overflow-auto">
              <LazyMarkdown text={body} components={DOC_CARD_MARKDOWN} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mt-2 text-caption font-medium text-muted underline underline-offset-2 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {showRaw ? "Rendered" : "Raw markdown"}
          </button>
        </div>
      ) : hasDoc ? (
        <p className="mt-3 border-t border-border-default pt-3 font-reading text-body-sm leading-relaxed text-muted">
          Scout is tracking an assignment for this topic. Refine it in the chat
          to see the latest draft here.
        </p>
      ) : (
        <p className="mt-3 border-t border-border-default pt-3 font-reading text-body-sm leading-relaxed text-muted">
          No assignment yet. Tell Scout what matters about this topic and it
          will draft one — and follow it on every research run.
        </p>
      )}
    </article>
  );
}

// The dateline / state beat under the topic. When a turn just wrote this doc,
// it shows a live signal pill instead of the static date — the visible proof
// the conversation moved the card.
function DocLine({
  hasDoc,
  updatedAt,
  beat,
}: {
  hasDoc: boolean;
  updatedAt?: string;
  beat: DocBeat;
}) {
  if (beat) {
    const label =
      beat === "created"
        ? "Assignment created just now"
        : beat === "removed"
          ? "Removing…"
          : "Assignment updated just now";
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-caption font-medium text-signal">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-signal motion-safe:animate-pulse"
        />
        {label}
      </span>
    );
  }
  if (hasDoc) {
    const date = formatDocDate(updatedAt, { year: false });
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-caption font-medium text-secondary">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-signal"
        />
        Assignment{date ? ` · updated ${date}` : ""}
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center text-caption font-medium text-muted">
      No assignment yet
    </span>
  );
}
