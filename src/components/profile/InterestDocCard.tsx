"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

// The "just changed" beat fired the instant a chat turn confirms a durable
// write to this interest's doc. It is the PER-139 no-dead-control proof: the
// conversation visibly moves the card, and only on a confirmed write — never
// optimistically. `created` for a brand-new interest, `updated` for a refine.
export type DocBeat = "created" | "updated" | null;

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

function formatDocDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Markdown components matched to the editorial tokens — same surface BriefView
// uses, scaled down for a card preview.
const MD = {
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="mt-3 font-serif text-[17px] text-primary first:mt-0"
      {...p}
    />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4
      className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-secondary first:mt-0"
      {...p}
    />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="mt-2 font-reading text-[14px] leading-relaxed text-secondary first:mt-0"
      {...p}
    />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="mt-2 list-disc space-y-1 pl-5 font-reading text-[14px] leading-relaxed text-secondary first:mt-0"
      {...p}
    />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="mt-2 list-decimal space-y-1 pl-5 font-reading text-[14px] leading-relaxed text-secondary first:mt-0"
      {...p}
    />
  ),
  li: (p: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="pl-0.5" {...p} />
  ),
  strong: (p: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-primary" {...p} />
  ),
  a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-signal underline underline-offset-2" {...p} />
  ),
  code: (p: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[12px] text-primary"
      {...p}
    />
  ),
};

export function InterestDocCard({
  model,
  focused,
  onFocusToggle,
}: {
  model: DocCardModel;
  focused: boolean;
  onFocusToggle: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const { topic, hasDoc, updatedAt, body, beat, href } = model;

  const open = () => {
    window.location.assign(href);
  };

  return (
    <article
      className={[
        "cursor-pointer rounded-lg border bg-surface p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        focused
          ? "border-signal"
          : "border-border-default hover:border-border-strong",
        // PER-230 AC6: an unmistakable card-level flash the instant a turn
        // confirms a durable write. The dateline pill (below) names what
        // changed; this ring/tint sweep makes the moved card impossible to miss.
        beat ? "scout-doc-flash" : "",
      ].join(" ")}
      aria-label={`Interest: ${topic}`}
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
            className="block truncate font-serif text-[19px] leading-tight text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
            "shrink-0 rounded-pill border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
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
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 font-mono text-[12px] leading-relaxed text-secondary">
              {body}
            </pre>
          ) : (
            <div className="scout-md max-h-64 overflow-auto">
              <ReactMarkdown components={MD}>{body}</ReactMarkdown>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted underline underline-offset-2 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {showRaw ? "Rendered" : "Raw markdown"}
          </button>
        </div>
      ) : hasDoc ? (
        <p className="mt-3 border-t border-border-default pt-3 font-reading text-[13px] leading-relaxed text-muted">
          Scout is tracking an intent doc for this interest. Refine it in the
          chat to see the latest draft here.
        </p>
      ) : (
        <p className="mt-3 border-t border-border-default pt-3 font-reading text-[13px] leading-relaxed text-muted">
          No intent doc yet. Tell Scout what matters about this topic and it
          will draft one — that doc steers every research run.
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
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-signal">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-signal motion-safe:animate-pulse"
        />
        {beat === "created" ? "Doc created just now" : "Doc updated just now"}
      </span>
    );
  }
  if (hasDoc) {
    const date = formatDocDate(updatedAt);
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-secondary">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-signal"
        />
        Intent doc{date ? ` · updated ${date}` : ""}
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-border-strong"
      />
      No intent doc yet
    </span>
  );
}
