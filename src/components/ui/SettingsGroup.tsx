import Link from "next/link";
import * as React from "react";

// One settings topic: a muted header, a rounded group whose rows are split by
// inset hairlines, and an optional one-line footer saying what it does.
export function SettingsGroup({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="px-1 text-body-sm font-medium text-secondary">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-surface">
        {children}
      </div>
      {footer && (
        <p className="px-1 text-caption text-muted text-pretty">{footer}</p>
      )}
    </section>
  );
}

/** One row in a SettingsGroup: a label on the left, its control on the right. */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      {/* A small basis keeps a short control (a bell) on the label's line
          at phone width; a wide one still wraps below. */}
      <div className="flex min-w-0 flex-[1_1_5rem] flex-col">
        <span className="text-body-sm text-primary">{label}</span>
        {hint && <span className="text-caption text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** A row that is a link to another page (Privacy, Terms, Delete account). */
export function SettingsLinkRow({
  href,
  children,
  tone = "default",
}: {
  href: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-body-sm transition first:rounded-t-card last:rounded-b-card hover:bg-surface-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${tone === "danger" ? "text-danger" : "text-primary"}`}
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
    </Link>
  );
}
