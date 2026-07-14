"use client";

import { useEffect, useId, useRef } from "react";

import type { PendingDelete } from "@/lib/chat";

// The confirm-gated delete card (PER-230). Delete is the ONE destructive op, so
// it is the ONLY one behind a confirmation. A turn that resolved to a delete does
// NOTHING to the store — it surfaces this card. The interest is removed only when
// the user presses [Delete]; [Cancel] keeps it. This honest gate sits BEFORE the
// destructive request, so create/update stay auto-apply (CEO decision on PER-230).
export type DeleteResolution = "deleted" | "cancelled" | undefined;

export function ChatDeleteConfirm({
  pd,
  resolved,
  autoFocus = true,
  onConfirm,
  onCancel,
  disabled,
}: {
  pd: PendingDelete;
  resolved: DeleteResolution;
  autoFocus?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const labelId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Remember what had focus when the card appeared so we can hand it back after
  // the user resolves the confirmation (AC8 — focus management). Captured once.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // On mount, move focus onto the freshly-appeared destructive confirmation so a
  // keyboard/SR user is taken to it (the spec's "focus moves correctly to confirm
  // cards"). We land on Cancel — the SAFE default — so a stray Enter keeps the
  // interest rather than deleting it.
  useEffect(() => {
    if (!autoFocus || resolved) return;
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      returnFocusRef.current =
        active instanceof HTMLElement ? active : null;
    }
    cancelRef.current?.focus();
  }, [autoFocus, resolved]);

  // Once the turn resolves (Delete/Cancel pressed), the action buttons unmount.
  // Return focus to wherever it was before the card took it (the composer), so a
  // keyboard/SR user is not stranded on a now-inert card.
  useEffect(() => {
    if (resolved) returnFocusRef.current?.focus();
  }, [resolved]);

  return (
    <div
      role="alertdialog"
      aria-labelledby={labelId}
      className="my-3 overflow-hidden rounded-md border border-border-strong bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-border-default px-2.5 py-2">
        <span
          aria-hidden="true"
          className="grid size-[18px] place-items-center rounded-sm bg-danger font-mono text-[11px] font-semibold leading-none text-[color:var(--danger-bg)]"
        >
          −
        </span>
        <span
          id={labelId}
          className="font-mono text-[10px] uppercase tracking-[0.05em] text-secondary"
        >
          Confirm delete · {pd.topic}
        </span>
        {resolved && (
          <span
            className={[
              "ml-auto rounded-pill border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em]",
              resolved === "deleted"
                ? "border-success-border bg-success-bg text-success"
                : "border-border-default bg-surface-muted text-muted",
            ].join(" ")}
          >
            {resolved === "deleted" ? "Removed" : "Kept"}
          </span>
        )}
      </div>

      <p className="px-2.5 pt-2.5 font-reading text-[14px] leading-[1.5] text-primary">
        Delete <span className="font-semibold">“{pd.topic}”</span>? This removes
        it from your saved interests.
      </p>

      <div className="flex items-center gap-2 px-2.5 py-2.5">
        {resolved ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-muted">
            {resolved === "deleted"
              ? "Removed from your interests"
              : "Left your interests unchanged"}
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={onConfirm}
              className="rounded-sm border border-danger-border bg-danger-bg px-3 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-danger transition-colors hover:bg-danger-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
            >
              Delete
            </button>
            <button
              ref={cancelRef}
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="rounded-sm border border-border-default bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-secondary transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
            >
              Cancel
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
