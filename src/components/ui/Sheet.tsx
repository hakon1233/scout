"use client";

import * as React from "react";

// A sheet: a native <dialog> opened with showModal, so focus is trapped, Esc
// closes it and the page behind is inert without any library. A bottom sheet
// on a phone, a centred panel from 640 px. Hand-built because the app has no
// dialog primitive yet and every sheet (publish, report) needs the same one.

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  /** The action row; primary last (right-aligned). */
  footer?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget) onClose();
      }}
      // backdrop: the theme's scrim token; Tailwind has no utility for it.
      className="glass glass-strong m-0 mt-auto w-full max-w-none rounded-t-card p-0 text-primary backdrop:bg-[var(--scrim)] sm:m-auto sm:max-w-md sm:rounded-card"
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <h2
            id={titleId}
            className="font-serif text-title-3 text-primary [text-wrap:balance]"
          >
            {title}
          </h2>
          <div className="flex flex-col gap-3 text-body-sm text-secondary">
            {children}
          </div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
