"use client";

import * as React from "react";
import type { ChatConfirm, ChatTurn } from "@scout/core";
import { ChatMarkdown } from "@/components/profile/ChatMarkdown";
import {
  ChatRewriteProposal,
  type RewriteResolution,
} from "@/components/profile/ChatActionCard";
import {
  ChatDeleteConfirm,
  type DeleteResolution,
} from "@/components/profile/ChatDeleteConfirm";
import { Button } from "@/components/ui";
import { HostedError } from "@/lib/hosted";

// The hosted setup chat: the reader says what they want to follow, Scout
// answers and changes their interests. Only the last turn's proposals
// (delete, rewrite, follow) can be confirmed; the Worker checks them again.
export function HostedChat({
  turns,
  send,
  confirm,
  label,
  autoFocus = false,
}: {
  turns: ChatTurn[];
  // Both resolve once the turn is stored; the parent appends it and reloads.
  send: (message: string) => Promise<void>;
  confirm: (action: ChatConfirm) => Promise<void>;
  // The composer's visible label.
  label: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resolved, setResolved] = React.useState<
    Record<string, "done" | "kept">
  >({});
  const fieldId = React.useId();
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns.length, sending]);

  async function submit() {
    const message = draft.trim();
    if (!message) {
      setError("Write what you want to follow first.");
      return;
    }
    setError(null);
    setSending(message);
    setDraft("");
    try {
      await send(message);
    } catch (err) {
      setDraft(message);
      setError(messageOf(err));
    } finally {
      setSending(null);
    }
  }

  async function settle(key: string, action: ChatConfirm | null) {
    if (!action) {
      setResolved((r) => ({ ...r, [key]: "kept" }));
      return;
    }
    setError(null);
    try {
      await confirm(action);
      setResolved((r) => ({ ...r, [key]: "done" }));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const last = turns.at(-1);
  return (
    <div className="flex flex-col gap-6">
      {turns.length > 0 && (
        <ol className="flex flex-col gap-6" aria-label="Chat with Scout">
          {turns.map((turn) => (
            <li key={turn.id} className="flex flex-col gap-3">
              <YouSaid text={turn.message} />
              {turn.status === "failed" ? (
                <p className="text-body-sm text-danger">
                  {turn.error_msg ?? "That didn't work. Try again."}
                </p>
              ) : (
                <>
                  {turn.reply && <ChatMarkdown text={turn.reply} />}
                  <Changes turn={turn} />
                  {turn === last && (
                    <Proposals
                      turn={turn}
                      resolved={resolved}
                      settle={settle}
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {sending && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <YouSaid text={sending} />
          <p className="text-body-sm text-muted">Scout is thinking…</p>
        </div>
      )}
      <div ref={endRef} />

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={fieldId} className="text-body-sm text-secondary">
          {label}
        </label>
        <textarea
          id={fieldId}
          value={draft}
          autoFocus={autoFocus}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="For example: new Rust releases and accepted RFCs"
          className="min-h-20 w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-primary placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        />
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" loading={sending !== null}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function YouSaid({ text }: { text: string }) {
  return (
    <p className="self-end whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 text-body text-primary sm:max-w-[80%]">
      <span className="sr-only">You: </span>
      {text}
    </p>
  );
}

// What the turn already changed, as one quiet line.
function Changes({ turn }: { turn: ChatTurn }) {
  const parts = (turn.changes ?? []).map((c) => {
    const topic = `“${c.topic ?? "topic"}”`;
    if (c.op === "create") return `Added ${topic}`;
    if (c.op === "delete") return `Removed ${topic}`;
    return `Updated ${topic}`;
  });
  if (parts.length === 0) return null;
  return <p className="text-body-sm text-muted">{parts.join(" · ")}.</p>;
}

function Proposals({
  turn,
  resolved,
  settle,
}: {
  turn: ChatTurn;
  resolved: Record<string, "done" | "kept">;
  settle: (key: string, action: ChatConfirm | null) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const run = async (key: string, action: ChatConfirm | null) => {
    setBusy(true);
    await settle(key, action);
    setBusy(false);
  };
  const deletes = turn.pending_deletes ?? [];
  const delKey = `${turn.id}:delete`;
  const rewrite = turn.pending_rewrite;
  const rwKey = `${turn.id}:rewrite`;
  return (
    <>
      {deletes.length > 0 && (
        <ChatDeleteConfirm
          pds={deletes}
          resolved={deleteResolution(resolved[delKey])}
          disabled={busy}
          onConfirm={() =>
            run(delKey, {
              kind: "delete",
              interestIds: deletes.map((d) => d.interestId),
            })
          }
          onCancel={() => run(delKey, null)}
        />
      )}
      {rewrite && (
        <ChatRewriteProposal
          pr={rewrite}
          prev={null}
          resolved={rewriteResolution(resolved[rwKey])}
          disabled={busy}
          onApply={() =>
            run(rwKey, { kind: "rewrite", interestId: rewrite.interestId })
          }
          onDiscard={() => run(rwKey, null)}
        />
      )}
      {(turn.pending_follows ?? []).map((f) => {
        const key = `${turn.id}:follow:${f.interestId}`;
        return (
          <div key={key} className="flex flex-wrap items-center gap-3">
            {resolved[key] === "done" ? (
              <p className="text-body-sm text-muted">Following “{f.topic}”.</p>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(key, { kind: "follow", interestId: f.interestId })
                }
              >
                Follow “{f.topic}”
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}

function deleteResolution(r: "done" | "kept" | undefined): DeleteResolution {
  return r === "done" ? "deleted" : r === "kept" ? "cancelled" : undefined;
}

function rewriteResolution(r: "done" | "kept" | undefined): RewriteResolution {
  return r === "done" ? "applied" : r === "kept" ? "discarded" : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof HostedError
    ? err.message
    : "Something went wrong. Try again.";
}
