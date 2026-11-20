import * as React from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Shown but not pickable now, e.g. a choice that needs another plan. */
  disabled?: boolean;
};

// A small segmented control for one choice out of two to four: a tinted track
// with no border, the chosen segment lifted onto the surface. It applies at
// once (the caller saves on change). A radiogroup, so it reads as one choice.
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  /** Accessible name for the group. */
  label: string;
  /** The chosen value, or null before it is known (nothing shows as chosen). */
  value: T | null;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-muted p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || opt.disabled}
            suppressHydrationWarning
            onClick={() => onChange(opt.value)}
            className={
              "inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-body-sm transition phone:min-h-11 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-60 " +
              (active
                ? "bg-surface font-medium text-primary shadow-sm"
                : "text-secondary hover:text-primary")
            }
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
