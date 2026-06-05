"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui";

// One rendered line in the chat transcript. `you` is the founder's raw message
// (never the scope-prefixed wire form); `scout` is the assistant's reply or a
// system note about what changed.
export type ChatMessage = {
  id: string;
  role: "you" | "scout";
  text: string;
  // A faint dateline; omitted for the seeded greeting.
  ts?: string;
};

function clock(ts?: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const CHAT_MD = {
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="mt-1 font-serif text-[18px] leading-tight text-primary first:mt-0"
      {...p}
    />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="mt-1 font-serif text-[17px] leading-tight text-primary first:mt-0"
      {...p}
    />
  ),
  h3: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4
      className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-secondary first:mt-0"
      {...p}
    />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="my-1.5 first:mt-0 last:mb-0" {...p} />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="my-1.5 list-disc space-y-1 pl-5 first:mt-0 last:mb-0"
      {...p}
    />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-1.5 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0"
      {...p}
    />
  ),
  li: (p: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="pl-0.5 leading-relaxed" {...p} />
  ),
  blockquote: (p: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="my-2 border-l-2 border-border-strong pl-3 text-secondary first:mt-0 last:mb-0"
      {...p}
    />
  ),
  strong: (p: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold" {...p} />
  ),
  em: (p: React.HTMLAttributes<HTMLElement>) => (
    <em className="italic opacity-85" {...p} />
  ),
  a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-signal underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  pre: (p: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="my-2 max-w-full overflow-x-auto rounded-md border border-border-default bg-page p-3 font-mono text-[12px] leading-relaxed text-primary first:mt-0 last:mb-0"
      {...p}
    />
  ),
  code: ({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement>) => {
    if (className) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[12px] text-primary"
        {...props}
      >
        {children}
      </code>
    );
  },
};

function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="break-words font-reading text-[15px] leading-relaxed [&_*]:max-w-full">
      <ReactMarkdown components={CHAT_MD}>{text}</ReactMarkdown>
    </div>
  );
}

// The conversation surface: a scrolling transcript over a pinned composer. ONE
// chat manages the whole interest collection; the targeting chip just tells the
// founder (and Scout) which interest the next message is aimed at.
export function ChatDock({
  messages,
  sending,
  error,
  focusTopic,
  onClearFocus,
  onSend,
}: {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  focusTopic: string | null;
  onClearFocus: () => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest turn in view as the transcript grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section
      aria-label="Chat with Scout"
      className="flex flex-col overflow-hidden rounded-lg border border-border-default bg-surface lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)]"
    >
      <header className="flex items-center gap-2.5 border-b border-border-default px-4 py-3">
        <span aria-hidden="true" className="h-[1.5px] w-[22px] bg-signal" />
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-signal">
          Scout
        </span>
        <span className="font-mono text-[11px] text-muted">
          talk to shape your interests
        </span>
      </header>

      {/* Transcript */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation with Scout"
        className="flex max-h-[46vh] min-h-[12rem] flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 lg:max-h-none"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "you"
                ? "flex flex-col items-end gap-0.5"
                : "flex flex-col items-start gap-0.5"
            }
          >
            <div
              className={
                m.role === "you"
                  ? "max-w-[85%] rounded-lg rounded-br-sm bg-accent px-3.5 py-2 font-reading text-[15px] leading-relaxed text-accent-fg"
                  : "max-w-[90%] rounded-lg rounded-bl-sm border border-border-default bg-surface-muted px-3.5 py-2 font-reading text-[15px] leading-relaxed text-primary"
              }
            >
              <ChatMarkdown text={m.text} />
            </div>
            <span className="px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              {m.role === "you" ? "You" : "Scout"}
              {m.ts ? ` · ${clock(m.ts)}` : ""}
            </span>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-signal motion-safe:animate-pulse"
            />
            Scout is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer — pinned to the bottom of the dock; sticky on mobile so it
          stays reachable while the page scrolls. */}
      <form
        className="sticky bottom-0 flex flex-col gap-2 border-t border-border-default bg-surface px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em]">
          {focusTopic ? (
            <button
              type="button"
              onClick={onClearFocus}
              className="inline-flex max-w-full items-center gap-1.5 rounded-pill border border-signal/40 bg-surface-muted px-2.5 py-1 text-signal transition-colors hover:border-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              aria-label={`Editing ${focusTopic} — clear focus to talk about all interests`}
            >
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full bg-signal"
              />
              <span className="truncate normal-case tracking-normal">
                Editing: {focusTopic}
              </span>
              <span aria-hidden="true" className="text-muted">
                ✕
              </span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-border-default px-2.5 py-1 text-muted">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-border-strong"
              />
              All interests
            </span>
          )}
        </div>

        <div className="flex items-end gap-2">
          <label htmlFor="scout-composer" className="sr-only">
            Message Scout
          </label>
          <textarea
            id="scout-composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            disabled={sending}
            placeholder={
              focusTopic
                ? `Refine “${focusTopic}” — what should Scout track?`
                : "Add, refine, or remove an interest…"
            }
            className="min-h-[44px] flex-1 resize-none rounded-md border border-border-default bg-page px-3 py-2 font-reading text-[15px] leading-relaxed text-primary placeholder:text-muted focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60"
          />
          <Button
            type="submit"
            size="md"
            loading={sending}
            disabled={!draft.trim()}
            className="min-h-[44px] shrink-0"
          >
            Send
          </Button>
        </div>

        {error ? (
          <p role="alert" className="font-mono text-[11px] text-danger">
            {error}
          </p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
            Enter to send · Shift+Enter for a new line
          </p>
        )}
      </form>
    </section>
  );
}
