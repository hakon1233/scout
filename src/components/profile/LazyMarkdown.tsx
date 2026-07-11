"use client";

import * as React from "react";
import type { Components } from "react-markdown";

// Every profile/interests/chat surface that renders markdown on first paint
// used to ship the full `react-markdown` + `rehype-sanitize` pipeline (~170KB
// raw) in its first-load JS. The `/app` feed already split this via
// `next/dynamic` (see `FeedView.tsx`'s dynamic `FeedBody`), but it had no
// first-paint markdown to preserve.
//
// Here the views ARE reading-first, so a blank placeholder would flash. Instead
// we defer the pipeline behind `React.lazy` and fall back to the *raw text* in
// the same column — content stays present and the layout stays stable while the
// shared chunk loads (sub-second, and cached after the first markdown render
// anywhere in the session). Small and reversible: swap `LazyMarkdown` back for a
// direct `<ReactMarkdown>` to revert.
const MarkdownRenderer = React.lazy(() => import("./MarkdownRenderer"));

export type LazyMarkdownProps = {
  text: string;
  components?: Components;
  sanitize?: boolean;
};

export function LazyMarkdown({ text, components, sanitize }: LazyMarkdownProps) {
  return (
    <React.Suspense
      fallback={<div className="whitespace-pre-wrap">{text}</div>}
    >
      <MarkdownRenderer text={text} components={components} sanitize={sanitize} />
    </React.Suspense>
  );
}
