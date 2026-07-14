"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChatChange, PendingRewrite } from "@/lib/chat";
import { lineDiff, type DiffLine } from "@/lib/chat-diff";

// One inline action card under a Scout turn (PER-228 chunk 5). It is the visible
// proof a turn moved a doc — the PER-139 no-dead-control contract.
//
// IMPORTANT — honesty over the wireframe: a turn's `changes[]` are ALREADY
// durable on disk by the time the FE sees them (see src/lib/chat.ts), so for
// those there is no real "Apply/Discard" to gate — every action card renders as
// Applied, and the only honest reversible affordance is Undo (a reversing
// instruction sent as a normal turn). The TWO real propose/pending channels are
// `pending_delete` (PER-230) and `pending_rewrite` (PER-235): the companion
// explicitly did NOT apply those, and each has a deterministic confirm route —
// so ChatDeleteConfirm's [Delete]/[Cancel] and ChatRewriteProposal's
// [Apply]/[Discard] below are real controls, not dead ones.

export type ActionCardModel = {
  // The durable change the turn applied.
  change: ChatChange;
  // The doc body just before this change, when known — powers the diff and the
  // undo of an update/delete. Null when we never saw the prior body.
  prev: string | null;
};

function opMeta(op: ChatChange["op"]): {
  glyph: string;
  verb: string;
  tone: "create" | "update" | "delete";
} {
  if (op === "create") return { glyph: "+", verb: "Created", tone: "create" };
  if (op === "delete") return { glyph: "−", verb: "Removed", tone: "delete" };
  return { glyph: "~", verb: "Updated", tone: "update" };
}

function diffFor(change: ChatChange, prev: string | null): DiffLine[] {
  const next = typeof change.doc === "string" ? change.doc : "";
  if (change.op === "create") return lineDiff("", next);
  if (change.op === "delete") return lineDiff(prev ?? "", "");
  return lineDiff(prev ?? "", next);
}

export function ChatActionCard({
  model,
  onUndo,
  disabled,
}: {
  model: ActionCardModel;
  onUndo: (change: ChatChange, prev: string | null) => void;
  disabled: boolean;
}) {
  const [requested, setRequested] = useState(false);
  const { change, prev } = model;
  const { glyph, verb, tone } = opMeta(change.op);
  const topic = change.topic ?? "interest";
  const diff = diffFor(change, prev);

  const iconBg =
    tone === "delete"
      ? "bg-danger text-[color:var(--danger-bg)]"
      : "bg-signal text-[color:var(--accent-fg)]";

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border-strong bg-surface">
      <div className="flex items-center gap-2 border-b border-border-default px-2.5 py-2">
        <span
          aria-hidden="true"
          className={`grid size-[18px] place-items-center rounded-sm font-mono text-[11px] font-semibold leading-none ${iconBg}`}
        >
          {glyph}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-secondary">
          {verb} · {topic}
        </span>
        <span className="ml-auto rounded-pill border border-success-border bg-success-bg px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] text-success">
          Applied
        </span>
      </div>

      {diff.length > 0 ? (
        <div className="max-h-56 overflow-auto py-1.5 font-mono text-[11px] leading-[1.5]">
          {diff.map((ln, i) => (
            <div
              key={i}
              className={[
                "flex px-2.5",
                ln.kind === "add"
                  ? "bg-success-bg"
                  : ln.kind === "del"
                    ? "bg-danger-bg"
                    : "",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "w-3.5 shrink-0 select-none",
                  ln.kind === "add"
                    ? "text-success"
                    : ln.kind === "del"
                      ? "text-danger"
                      : "text-muted",
                ].join(" ")}
              >
                {ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : " "}
              </span>
              <span className="whitespace-pre-wrap break-words text-primary">
                {ln.text || " "}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border-default px-2.5 py-2">
        <button
          type="button"
          disabled={disabled || requested}
          onClick={() => {
            setRequested(true);
            onUndo(change, prev);
          }}
          className="rounded-sm border border-border-default bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
        >
          {requested ? "Undo sent" : "Undo"}
        </button>
        <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
          {requested ? "Asked Scout to reverse this" : "Steers your next run"}
        </span>
      </div>
    </div>
  );
}

// How a rewrite proposal card was resolved, persisted on the message so the
// card locks after the choice (PER-235). Undefined = still awaiting a choice.
export type RewriteResolution = "applied" | "discarded" | undefined;

// Confirm-gated rewrite proposal (PER-235): the companion proposed a full
// replacement doc but did NOT write it. Renders the diff between the doc the
// FE last saw and the proposal, with real [Apply]/[Discard] controls — Apply
// hits the deterministic /v0/chat/confirm-rewrite route; Discard is FE-local
// (the doc was never touched, so there is nothing to undo server-side).
// Mirrors ChatDeleteConfirm's alertdialog/focus pattern: initial focus lands
// on the SAFE button (Discard), and focus returns to the prior element once
// the card resolves.
export function ChatRewriteProposal({
  pr,
  prev,
  resolved,
  autoFocus = true,
  onApply,
  onDiscard,
  disabled,
}: {
  pr: PendingRewrite;
  // The doc body before the proposal, when known. Null (e.g. a card re-rendered
  // from the transcript) degrades the diff to all-adds — still honest, since
  // the proposal IS the full replacement text.
  prev: string | null;
  resolved: RewriteResolution;
  autoFocus?: boolean;
  onApply: () => void;
  onDiscard: () => void;
  disabled: boolean;
}) {
  const labelId = useId();
  const discardRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const diff = lineDiff(prev ?? "", pr.doc);

  // Capture where focus was, then move it to the safe choice. When the card
  // resolves, hand focus back so keyboard users aren't stranded.
  useEffect(() => {
    if (!autoFocus || resolved) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    discardRef.current?.focus();
  }, [autoFocus, resolved]);
  useEffect(() => {
    if (resolved) returnFocusRef.current?.focus();
  }, [resolved]);

  const buttonClass =
    "rounded-sm border border-border-default bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50";

  return (
    <div
      role={resolved ? undefined : "alertdialog"}
      aria-labelledby={labelId}
      className="my-3 overflow-hidden rounded-md border border-border-strong bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-border-default px-2.5 py-2">
        <span
          aria-hidden="true"
          className="grid size-[18px] place-items-center rounded-sm bg-signal font-mono text-[11px] font-semibold leading-none text-[color:var(--accent-fg)]"
        >
          ~
        </span>
        <span
          id={labelId}
          className="font-mono text-[10px] uppercase tracking-[0.05em] text-secondary"
        >
          Proposed rewrite · {pr.topic}
        </span>
        {resolved === "applied" ? (
          <span className="ml-auto rounded-pill border border-success-border bg-success-bg px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] text-success">
            Applied
          </span>
        ) : resolved === "discarded" ? (
          <span className="ml-auto rounded-pill border border-border-default bg-surface-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
            Discarded
          </span>
        ) : (
          <span className="ml-auto rounded-pill border border-border-default bg-surface-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
            Pending
          </span>
        )}
      </div>

      {diff.length > 0 ? (
        <div className="max-h-56 overflow-auto py-1.5 font-mono text-[11px] leading-[1.5]">
          {diff.map((ln, i) => (
            <div
              key={i}
              className={[
                "flex px-2.5",
                ln.kind === "add"
                  ? "bg-success-bg"
                  : ln.kind === "del"
                    ? "bg-danger-bg"
                    : "",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "w-3.5 shrink-0 select-none",
                  ln.kind === "add"
                    ? "text-success"
                    : ln.kind === "del"
                      ? "text-danger"
                      : "text-muted",
                ].join(" ")}
              >
                {ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : " "}
              </span>
              <span className="whitespace-pre-wrap break-words text-primary">
                {ln.text || " "}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border-default px-2.5 py-2">
        {resolved ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
            {resolved === "applied"
              ? "Rewrite written to the doc"
              : "Proposal discarded — doc untouched"}
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={onApply}
              className={buttonClass}
            >
              Apply
            </button>
            <button
              ref={discardRef}
              type="button"
              disabled={disabled}
              onClick={onDiscard}
              className={buttonClass}
            >
              Discard
            </button>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
              Nothing happens until you choose
            </span>
          </>
        )}
      </div>
    </div>
  );
}
