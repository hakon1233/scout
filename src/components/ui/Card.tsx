import * as React from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padding?: "none" | "sm" | "md" | "lg";
  tone?: "default" | "muted" | "dashed";
};

const padMap = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} as const;

const toneMap = {
  default: "border border-border-default bg-surface",
  muted: "border border-border-default bg-surface-muted",
  dashed: "border border-dashed border-border-strong bg-transparent",
} as const;

export function Card({
  padding = "md",
  tone = "default",
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`rounded-md ${toneMap[tone]} ${padMap[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
