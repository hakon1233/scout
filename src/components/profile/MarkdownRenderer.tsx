"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

// The heavy half of the markdown pipeline lives here ALONE so it can be
// code-split out of the profile/interests/chat routes that render markdown on
// first paint. `react-markdown` + `rehype-sanitize` (~170KB raw) are the only
// imports in this module; it is reached exclusively via `LazyMarkdown`'s
// `React.lazy` boundary, so the pipeline ships in its own chunk fetched on the
// first markdown render rather than in every route's first-load JS.
export type MarkdownRendererProps = {
  text: string;
  components?: Components;
  // Chat + the standalone interest page accept companion-authored markdown that
  // may contain raw HTML, so they sanitize. The doc-card / scope previews render
  // first-party doc bodies and keep their existing (un-sanitized) behavior.
  sanitize?: boolean;
};

export default function MarkdownRenderer({
  text,
  components,
  sanitize,
}: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      components={components}
      rehypePlugins={sanitize ? [rehypeSanitize] : undefined}
    >
      {text}
    </ReactMarkdown>
  );
}
