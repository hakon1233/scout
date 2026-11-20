"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// The in-depth body arrives as RAW markdown from the brief's `> ` blockquote
// lines (companion.ts keeps it unstripped on purpose — only card blurbs are
// plain-stripped). Render it as sanitized markdown styled to the editorial
// type, instead of dumping literal `**bold**`/backticks into <p> tags. Live
// briefs use bold + inline code heavily; links, lists, and quotes are styled
// too so future bodies degrade gracefully.
//
// Safety: rehype-sanitize (GitHub's schema) runs on every body and raw HTML is
// never enabled (no rehype-raw), so model text can't inject markup. Images in
// the body are dropped — the story keeps only its lead image — and links carry
// rel="nofollow ugc noopener" because the model, not us, chose them.
//
// This module is the ONLY feed-side importer of react-markdown +
// rehype-sanitize (~170KB of JS). It renders solely inside the single-story
// detail view, which the feed grid never mounts until the reader opens a card.
// FeedView pulls it in via `next/dynamic`, so the markdown pipeline is split
// out of the /app initial bundle and fetched on first detail open.
const heading = ({ children }: { children?: React.ReactNode }) => (
  <h3 className="font-reading text-body font-semibold text-primary">
    {children}
  </h3>
);

const BODY_MD = {
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  img: () => null,
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-reading text-body leading-relaxed text-muted">
      {children}
    </p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-primary">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  // The default <pre> wraps a <code>; pass through so the code chip styling
  // applies once (same trick as ChatMarkdown).
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em] text-primary">
      {children}
    </code>
  ),
  a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="nofollow ugc noopener"
        className="text-signal underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 font-reading text-body leading-relaxed text-secondary">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 font-reading text-body leading-relaxed text-secondary">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="my-1">{children}</li>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-border-strong pl-4 text-secondary">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-reading text-body-sm text-secondary">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-border-strong px-2 py-1 text-left font-semibold text-primary">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-border-default px-2 py-1 align-top">
      {children}
    </td>
  ),
  hr: () => <hr className="border-border-default" />,
};

export default function FeedBody({ markdown }: { markdown: string }) {
  return (
    <div className="flex flex-col gap-4 [&>p:first-child]:font-semibold [&>p:first-child]:text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={BODY_MD}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
