import * as React from "react";

type Tone = "info" | "success" | "warning" | "danger";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  tone?: Tone;
};

const toneStyles: Record<Tone, string> = {
  info: "border-info-border bg-info-bg text-info",
  success: "border-success-border bg-success-bg text-success",
  warning: "border-warning-border bg-warning-bg text-warning",
  danger: "border-danger-border bg-danger-bg text-danger",
};

export function Banner({
  tone = "info",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-body-sm ${toneStyles[tone]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
