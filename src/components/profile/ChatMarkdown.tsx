"use client";

import { useState } from "react";
import { LazyMarkdown } from "./LazyMarkdown";

// Sanitized markdown for the chat transcript (PER-228 chunk 4). Raw HTML is
// stripped by rehype-sanitize — assistant text is rendered as full-column
// editorial prose (Newsreader 17px/1.6), code/tool output in JetBrains Mono
// with a copy button, long blocks collapsible. Inline code stays quiet.

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard blocked — no-op, button stays idle */
        }
      }}
      className="rounded-sm border border-border-default bg-surface px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-muted transition-colors hover:border-border-strong hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      aria-label={copied ? "Copied" : "Copy code"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// A framed code/tool block: mono, copyable, and collapsible when it runs long
// so a wall of output never buries the reply.
function CodeBlock({ raw }: { raw: string }) {
  const lines = raw.replace(/\n$/, "").split("\n");
  const long = lines.length > 12;
  const [open, setOpen] = useState(!long);
  return (
    <div className="my-2.5 overflow-hidden rounded-md border border-border-default bg-page first:mt-0 last:mb-0">
      <div className="flex items-center justify-between gap-2 border-b border-border-default bg-surface-muted px-2.5 py-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
        <div className="flex items-center gap-1.5">
          {long ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-sm border border-border-default bg-surface px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-muted transition-colors hover:border-border-strong hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              aria-expanded={open}
            >
              {open ? "Collapse" : `Expand ${lines.length} lines`}
            </button>
          ) : null}
          <CopyButton getText={() => raw} />
        </div>
      </div>
      {open ? (
        <pre className="max-w-full overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-primary">
          {raw.replace(/\n$/, "")}
        </pre>
      ) : null}
    </div>
  );
}

function nodeToText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(nodeToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return nodeToText(
      (children as { props?: { children?: React.ReactNode } }).props?.children,
    );
  }
  return "";
}

const COMPONENTS = {
  // The default <pre> wraps a <code>; pass through so <code> owns the frame and
  // we never double-frame block code.
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement>) => {
    // Block code carries a language-* class from the fence; inline code doesn't.
    if (className && className.includes("language-")) {
      return <CodeBlock raw={nodeToText(children)} />;
    }
    return (
      <code
        className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em] text-primary"
        {...props}
      >
        {children}
      </code>
    );
  },
  a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-signal underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
};

// Assistant prose: full-column editorial Newsreader, NO bubble. Uses the shared
// `.scout-md` type rules (same surface BriefView uses) so headings/lists/quotes
// match the rest of the editorial UI.
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="scout-md break-words text-[17px] leading-[1.6] text-primary [&_*]:max-w-full">
      <LazyMarkdown text={text} components={COMPONENTS} sanitize />
    </div>
  );
}
