"use client";

import ReactMarkdown from "react-markdown";
import type { Brief } from "@/lib/types";

export function BriefView({ brief }: { brief: Brief }) {
  const generated = new Date(brief.generatedAt);
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Generated {generated.toLocaleString()}
        </p>
        <p className="text-xs text-zinc-500">
          {brief.articles.length} source{brief.articles.length === 1 ? "" : "s"} ·
          topics: {brief.interests.join(", ")}
        </p>
      </header>

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

      <details className="mt-4 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">
          Sources used ({brief.articles.length})
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {brief.articles.map((a) => (
            <li key={a.id}>
              <a
                className="underline"
                href={a.url}
                target="_blank"
                rel="noreferrer"
              >
                {a.title || a.url}
              </a>
              {a.source && (
                <span className="text-zinc-500"> — {a.source}</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
