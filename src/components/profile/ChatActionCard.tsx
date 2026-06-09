"use client";

import { useState } from "react";
import type { ChatChange } from "@/lib/chat";
import { lineDiff, type DiffLine } from "@/lib/chat-diff";

// One inline action card under a Scout turn (PER-228 chunk 5). It is the visible
// proof a turn moved a doc — the PER-139 no-dead-control contract.
//
// IMPORTANT — honesty over the wireframe: the companion has NO propose/pending
// mode. A turn's `changes[]` are ALREADY durable on disk by the time the FE sees
// them (see src/lib/chat.ts). So there is no real "Apply/Discard" to gate —
// every card renders as Applied. The only honest reversible affordance is Undo,
// which composes a reversing instruction and sends it as a normal turn (no
// contract change). Rendering fake confirm buttons would be a dead control.

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
