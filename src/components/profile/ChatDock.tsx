"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatChange, PendingDelete, PendingRewrite } from "@/lib/chat";
import { prefersReducedMotion } from "@/lib/motion";
import {
  ChatActionCard,
  ChatRewriteProposal,
  type RewriteResolution,
} from "./ChatActionCard";
import { ChatDeleteConfirm, type DeleteResolution } from "./ChatDeleteConfirm";
import { ChatMarkdown } from "./ChatMarkdown";

// One rendered line in the chat transcript. `you` is the founder's raw message
// (never the scope-prefixed wire form); `scout` is the assistant's reply plus
// any durable doc changes that turn applied (rendered as inline action cards).
export type ChatMessage = {
  id: string;
  role: "you" | "scout";
  text: string;
  // A faint dateline; omitted for the seeded greeting.
  ts?: string;
  // Durable changes this scout turn applied (PER-228 chunk 5).
  changes?: ChatChange[];
  // Pre-change doc bodies keyed by interestId, for the diff/undo affordance.
  prev?: Record<string, string | null>;
  // A confirm-gated delete this turn proposed (PER-230). Renders a
  // [Delete]/[Cancel] card; the interest is removed only on [Delete].
  pendingDelete?: PendingDelete;
  // Whether the founder resolved the pending delete (and how).
  deleteResolved?: DeleteResolution;
  // A confirm-gated full rewrite this turn proposed (PER-235). Renders an
  // [Apply]/[Discard] diff card; the doc is written only on [Apply].
  pendingRewrite?: PendingRewrite;
  // Whether the founder resolved the pending rewrite (and how).
  rewriteResolved?: RewriteResolution;
  // A turn that failed — offer retry, render quietly.
  failed?: boolean;
};

const SUGGESTED_PROMPTS = [
  "Track EU AI Act enforcement",
  "Add semiconductor export controls",
  "Refine my climate-policy focus",
  "Drop anything about crypto prices",
];

function clock(ts?: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(pointer: coarse)");
    // matchMedia is unavailable at SSR/prerender; read the real value once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoarse(mq.matches);
    const on = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return coarse;
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// The conversation surface: a single scrolling transcript over a sticky
// composer. ONE chat manages the whole interest collection; the targeting chip
// tells the founder (and Scout) which interest the next message is aimed at.
export function ChatDock({
  messages,
  sending,
  error,
  focusTopic,
  streamId,
  streamLen,
  onClearFocus,
  onSend,
  onStop,
  onRetry,
  onUndo,
  onConfirmDelete,
  onCancelDelete,
  onConfirmRewrite,
  onDiscardRewrite,
}: {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  focusTopic: string | null;
  streamId: string | null;
  streamLen: number;
  onClearFocus: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: (scoutId: string) => void;
  onUndo: (change: ChatChange, prev: string | null) => void;
  onConfirmDelete: (pd: PendingDelete, msgId: string) => void;
  onCancelDelete: (msgId: string) => void;
  onConfirmRewrite: (pr: PendingRewrite, msgId: string) => void;
  onDiscardRewrite: (msgId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const coarse = useCoarsePointer();

  // Only the seeded greeting present → empty-state hero with prompt chips.
  const isEmpty = messages.length <= 1 && messages.every((m) => !m.ts);

  // The latest completed scout reply, for the polite live region (announce
  // COMPLETED turns only — never token-by-token, see chunk-3 a11y note below).
  const lastCompleted = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "scout" && m.id !== streamId) return m.text;
    }
    return "";
  })();

  const nearBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Autoscroll ONLY when the viewport is within ~80px of the bottom; otherwise
  // hold position and surface the "scroll to latest" pill (chunk 3).
  useEffect(() => {
    if (atBottom) scrollToBottom("auto");
  }, [messages, streamLen, sending, atBottom, scrollToBottom]);

  const onScroll = useCallback(() => {
    setAtBottom(nearBottom());
  }, [nearBottom]);

  // Auto-grow the composer (min ~44px → ~200px, then scroll).
  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);
  useEffect(() => {
    grow();
  }, [draft, grow]);

  function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
    requestAnimationFrame(() => {
      grow();
      setAtBottom(true);
      scrollToBottom("auto");
    });
  }

  return (
    <section
      aria-label="Chat with Scout"
      className="relative flex min-h-0 flex-1 flex-col bg-page"
      style={{ height: "100%" }}
    >
      {/* Polite live region: announces only the latest COMPLETED scout turn, so
          screen readers don't hear every streamed token. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {streamId ? "" : lastCompleted}
      </p>

      {/* Transcript — the single scroll container. */}
      <div
        ref={logRef}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation with Scout"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[720px] px-4 py-5 sm:px-6">
          {isEmpty ? (
            <EmptyState
              onPick={(p) => {
                onSend(p);
                setAtBottom(true);
              }}
            />
          ) : (
            messages.map((m, i) => {
              const prevRole = i > 0 ? messages[i - 1].role : null;
              const grouped = prevRole === m.role;
              if (m.role === "you") {
                return (
                  <div key={m.id} className={grouped ? "mt-2" : "mt-6"}>
                    {!grouped && (
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                        You{m.ts ? ` · ${clock(m.ts)}` : ""}
                      </p>
                    )}
                    <div className="inline-block rounded-md rounded-tl-sm border border-border-default bg-surface-muted px-3 py-2 font-reading text-[16px] leading-[1.5] text-primary">
                      {m.text}
                    </div>
                  </div>
                );
              }
              const isStreaming = m.id === streamId;
              const shown = isStreaming ? m.text.slice(0, streamLen) : m.text;
              return (
                <div
                  key={m.id}
                  className={`group/msg ${grouped ? "mt-3" : "mt-6"}`}
                >
                  {!grouped && (
                    <p className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
                      <span
                        aria-hidden="true"
                        className="inline-block size-1.5 rounded-full bg-signal"
                      />
                      Scout{m.ts ? ` · ${clock(m.ts)}` : ""}
                    </p>
                  )}
                  <div aria-hidden={isStreaming || undefined}>
                    <ChatMarkdown text={shown} />
                    {isStreaming && (
                      <span
                        aria-hidden="true"
                        className="ml-0.5 inline-block h-[17px] w-[7px] translate-y-[3px] bg-signal motion-safe:animate-[scout-caret_1s_steps(2)_infinite]"
                      />
                    )}
                  </div>

                  {m.changes?.map((ch, ci) => (
                    <ChatActionCard
                      key={`${m.id}-${ci}`}
                      model={{
                        change: ch,
                        prev: m.prev?.[ch.interestId] ?? null,
                      }}
                      onUndo={onUndo}
                      disabled={sending}
                    />
                  ))}

                  {m.pendingDelete && (
                    <ChatDeleteConfirm
                      pd={m.pendingDelete}
                      resolved={m.deleteResolved}
                      onConfirm={() => onConfirmDelete(m.pendingDelete!, m.id)}
                      onCancel={() => onCancelDelete(m.id)}
                      disabled={sending}
                    />
                  )}

                  {m.pendingRewrite && (
                    <ChatRewriteProposal
                      pr={m.pendingRewrite}
                      prev={m.prev?.[m.pendingRewrite.interestId] ?? null}
                      resolved={m.rewriteResolved}
                      onApply={() => onConfirmRewrite(m.pendingRewrite!, m.id)}
                      onDiscard={() => onDiscardRewrite(m.id)}
                      disabled={sending}
                    />
                  )}

                  {/* Per-message actions (chunk 6) — quiet, reveal on hover/focus. */}
                  {!isStreaming && (
                    <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
                      <CopyMessage text={m.text} />
                      <button
                        type="button"
                        onClick={() => onRetry(m.id)}
                        disabled={sending}
                        className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-40"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Working… status line during the poll, before the reply lands. */}
          {sending && !streamId && (
            <div className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
              <span
                aria-hidden="true"
                className="inline-block size-1.5 rounded-full bg-signal motion-safe:animate-pulse"
              />
              Working…
            </div>
          )}
        </div>
      </div>

      {/* Scroll-to-latest pill — only when held away from the bottom. */}
      {!atBottom && (
        <button
          type="button"
          onClick={() => {
            setAtBottom(true);
            // Smooth scroll is JS-driven, so the global reduced-motion CSS
            // can't clamp it — honor the preference explicitly here.
            scrollToBottom(prefersReducedMotion() ? "auto" : "smooth");
          }}
          className="absolute bottom-[120px] left-1/2 -translate-x-1/2 rounded-pill bg-accent px-3.5 py-1.5 font-mono text-[11px] text-accent-fg shadow-lg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ↓ Scroll to latest
        </button>
      )}

      {/* Sticky composer. */}
      <div
        className="border-t border-border-default bg-page"
        style={{
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto w-full max-w-[720px] px-4 pt-3 sm:px-6">
          {(focusTopic || error) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {focusTopic && (
                <button
                  type="button"
                  onClick={onClearFocus}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-pill border border-signal/40 bg-surface-muted px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-signal transition-colors hover:border-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  aria-label={`Editing ${focusTopic} — clear focus to talk about all interests`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-1.5 rounded-full bg-signal"
                  />
                  <span className="truncate normal-case tracking-normal">
                    Editing: {focusTopic}
                  </span>
                  <span aria-hidden="true">✕</span>
                </button>
              )}
              {error && (
                <p role="alert" className="font-mono text-[11px] text-danger">
                  {error}
                </p>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-end gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 focus-within:border-border-strong">
              <label htmlFor="scout-composer" className="sr-only">
                Message Scout
              </label>
              <textarea
                id="scout-composer"
                ref={taRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onInput={grow}
                onKeyDown={(e) => {
                  // ⌘/Ctrl+Enter always sends (works on every device).
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                    return;
                  }
                  // Fine pointers: bare Enter sends, Shift+Enter = newline.
                  // Coarse pointers (touch): Enter is a newline — send via button.
                  if (e.key === "Enter" && !e.shiftKey && !coarse) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={
                  focusTopic
                    ? `Refine “${focusTopic}”…`
                    : "Message Scout — add, refine, or remove an interest…"
                }
                className="max-h-[200px] min-h-[28px] flex-1 resize-none self-center bg-transparent font-reading text-[16px] leading-[1.5] text-primary placeholder:text-muted focus:outline-none"
              />
              {sending ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop"
                  className="grid size-9 shrink-0 place-items-center rounded-md bg-signal text-[color:var(--accent-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <span
                    aria-hidden="true"
                    className="block size-2.5 rounded-[2px] bg-current"
                  />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={!draft.trim()}
                  className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-40"
                >
                  <span aria-hidden="true" className="text-[15px] leading-none">
                    ↑
                  </span>
                </button>
              )}
            </div>
            <p className="mt-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
              {coarse
                ? "Tap ↑ to send · Enter for a new line"
                : "Enter to send · Shift+Enter for a new line"}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-start py-10">
      <span aria-hidden="true" className="mb-4 h-[2px] w-7 bg-signal" />
      <h2 className="font-serif text-[28px] font-semibold leading-tight text-primary">
        What should Scout track for you?
      </h2>
      <p className="mt-2 max-w-prose font-reading text-[17px] leading-[1.6] text-secondary">
        Tell me a topic and I&apos;ll draft an intent doc that steers every
        research run. Refine or drop interests any time — just say so.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-pill border border-border-default bg-surface px-3 py-1.5 font-reading text-[14px] text-secondary transition-colors hover:border-signal hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
