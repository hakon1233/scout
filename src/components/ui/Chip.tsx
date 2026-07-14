import * as React from "react";

type ChipProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  favicon?: string;
  index?: number;
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
  removeTitle?: string;
};

export function Chip({
  href,
  favicon,
  index,
  onRemove,
  removeLabel,
  removeDisabled = false,
  removeTitle,
  className = "",
  children,
  ...rest
}: ChipProps) {
  const base =
    "inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2 py-0.5 text-caption text-secondary no-underline align-baseline border border-border-default hover:bg-surface-strong";

  const content = (
    <>
      {typeof index === "number" && (
        <span className="font-medium text-primary">[{index}]</span>
      )}
      {favicon && (
        // eslint-disable-next-line @next/next/no-img-element -- 12px favicon; next/image's client runtime buys nothing under images.unoptimized:true.
        <img
          src={favicon}
          alt=""
          width={12}
          height={12}
          loading="lazy"
          className="h-3 w-3 rounded-sm"
        />
      )}
      <span className="truncate max-w-[16ch]">{children}</span>
    </>
  );

  if (onRemove) {
    const label =
      removeLabel ??
      `Remove ${typeof children === "string" ? children : "item"}`;
    return (
      <span className={`${base} pr-1 ${className}`}>
        {content}
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={label}
          title={removeTitle}
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
        >
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M2 2 L10 10 M10 2 L2 10" />
          </svg>
        </button>
      </span>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`${base} ${className}`}
        {...rest}
      >
        {content}
      </a>
    );
  }
  return <span className={`${base} ${className}`}>{content}</span>;
}
