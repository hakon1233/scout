"use client";

import ReactMarkdown from "react-markdown";
import { Card } from "@/components/ui";
import type { Brief } from "@/lib/types";

export function BriefView({ brief }: { brief: Brief }) {
  const generated = new Date(brief.generatedAt);
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-caption uppercase text-muted">
          Generated {generated.toLocaleString()}
        </p>
        <p className="text-caption text-muted">
          {brief.articles.length} source
          {brief.articles.length === 1 ? "" : "s"} · topics:{" "}
          {brief.interests.join(", ")}
        </p>
      </header>

      <Card tone="default" padding="lg">
        <div className="notiva-md">
          <ReactMarkdown
            components={{
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
      </Card>

      <details className="mt-4 rounded-md border border-border-default bg-surface p-3 text-body-sm">
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
    </article>
  );
}
