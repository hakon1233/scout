"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import type { Brief } from "@/lib/types";

export function BriefView({ brief }: { brief: Brief }) {
  const countsByTopicSlug = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of brief.articles) {
      const key = slugify(a.interest);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [brief.articles]);

  function sourceCountFor(headingText: string): number {
    const slug = slugify(headingText);
    if (countsByTopicSlug.has(slug)) return countsByTopicSlug.get(slug)!;
    for (const [k, v] of countsByTopicSlug) {
      if (slug.includes(k) || k.includes(slug)) return v;
    }
    return 0;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="notiva-md">
        <ReactMarkdown
          components={{
            // BriefLayout owns the editorial title; suppress the LLM's H1.
            h1: () => null,
            h2: ({ children }) => {
              const text = nodeToString(children);
              const id = slugify(text) || undefined;
              const count = sourceCountFor(text);
              return (
                <h2
                  id={id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <span>{children}</span>
                  {count > 0 && (
                    <span className="inline-flex items-center rounded-pill border border-border-default bg-surface-muted px-2 py-0.5 text-caption uppercase tracking-wide text-muted">
                      {count} source{count === 1 ? "" : "s"}
                    </span>
                  )}
                </h2>
              );
            },
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {brief.markdown}
        </ReactMarkdown>
      </div>

      <details className="rounded-md border border-border-default bg-surface-muted p-3 text-body-sm">
        <summary className="cursor-pointer font-medium text-primary">
          Sources used ({brief.articles.length})
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {brief.articles.map((a) => (
            <li key={a.id} className="text-secondary">
              <a
                className="text-primary underline"
                href={a.url}
                target="_blank"
                rel="noreferrer"
              >
                {a.title || a.url}
              </a>
              {a.source && <span className="text-muted"> — {a.source}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nodeToString(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToString).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return nodeToString(props.children);
  }
  return "";
}
