import * as React from "react";

type Variant = "primary" | "secondary" | "ghost" | "link" | "danger";
type Size = "sm" | "md";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "outline-none transition focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

const variantStyles: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover",
  secondary:
    "border border-border-strong bg-surface text-primary hover:bg-surface-muted",
  ghost: "text-primary hover:bg-surface-muted",
  link: "text-primary underline underline-offset-2 hover:opacity-80",
  danger:
    "border border-danger-border bg-danger-bg text-danger hover:bg-danger-bg-hover",
};

const sizeStyles: Record<Size, string> = {
  sm: "min-h-9 px-3 py-1.5 text-body-sm",
  md: "min-h-11 px-4 py-2 text-body-sm",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  const sizing = variant === "link" ? "text-body-sm" : sizeStyles[size];
  return `${base} ${variantStyles[variant]} ${sizing}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizing = variant === "link" ? "text-body-sm" : sizeStyles[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${variantStyles[variant]} ${sizing} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      <span>{children}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
