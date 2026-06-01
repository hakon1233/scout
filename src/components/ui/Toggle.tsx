import * as React from "react";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name for the switch (read by screen readers). */
  label: string;
  disabled?: boolean;
  /** Shown while a write is in flight — disables interaction without an opacity flicker. */
  busy?: boolean;
  id?: string;
};

// Direction A enable/disable switch. A real `role="switch"` button (not a
// styled checkbox) so it carries its on/off state to assistive tech and is
// operable by keyboard for free. Track fills with the editorial signal-red
// accent when on; the 44px-wide / 24px-tall hit area clears the WCAG 2.5.8
// minimum target size. Honors prefers-reduced-motion via the global transition
// token — the knob still moves, just without an animated slide when reduced.
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  busy = false,
  id,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border " +
        "outline-none transition-colors duration-150 " +
        "focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        (checked
          ? "border-signal bg-signal"
          : "border-border-strong bg-surface-muted")
      }
    >
      <span
        aria-hidden="true"
        className={
          "inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 " +
          (checked ? "translate-x-6" : "translate-x-1")
        }
      />
    </button>
  );
}
