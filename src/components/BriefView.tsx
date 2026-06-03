"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { Chip } from "@/components/ui";
import type { Article, Brief } from "@/lib/types";

type CitationEntry = {
  index: number;
  article: Article;
  hostname: string;
  favicon: string;
};

export function BriefView({ brief }: { brief: Brief }) {
  const countsByTopicSlug = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of brief.articles) {
      const key = slugify(a.interest);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [brief.articles]);

  // Per-topic intent-doc snapshot (PER-187), keyed by the topic slug so it lines
  // up with each `## <topic>` heading. This is the EXACT doc the companion fed
  // the research session for that section, captured at run time — the founder's
  // "what is this research based on?" answered inline, no trip to /app/profile.
  const basisByTopicSlug = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const b of brief.bases ?? []) {
      const doc = b.doc?.trim();
      if (doc) m.set(slugify(b.topic), doc);
    }
    return m;
  }, [brief.bases]);

  const citations = React.useMemo(() => buildCitations(brief), [brief]);

  const citationByUrl = React.useMemo(() => {
    const m = new Map<string, CitationEntry>();
    for (const c of citations) m.set(canonicalUrl(c.article.url), c);
    return m;
  }, [citations]);

  function sourceCountFor(headingText: string): number {
    const slug = slugify(headingText);
    if (countsByTopicSlug.has(slug)) return countsByTopicSlug.get(slug)!;
    for (const [k, v] of countsByTopicSlug) {
      if (slug.includes(k) || k.includes(slug)) return v;
    }
    return 0;
  }

  // Resolve the intent doc for a heading, mirroring sourceCountFor's exact-then-
  // fuzzy match so a heading the model capitalized slightly differently still
  // finds its basis. Returns null when no snapshot exists (older brief / no doc).
  function basisFor(headingText: string): string | null {
    const slug = slugify(headingText);
    if (basisByTopicSlug.has(slug)) return basisByTopicSlug.get(slug)!;
    for (const [k, v] of basisByTopicSlug) {
      if (slug.includes(k) || k.includes(slug)) return v;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="scout-md">
        <ReactMarkdown
          components={{
            h1: () => null,
            h2: ({ children }) => {
              const text = nodeToString(children);
              const id = slugify(text) || undefined;
              const count = sourceCountFor(text);
              const basis = basisFor(text);
              // A fragment, not a single <h2>: the "based on" disclosure is a
              // sibling block under the heading (a <details> can't live inside an
              // <h2>). react-markdown renders both as flow children of the
              // container, so they stack correctly above the section's bullets.
              return (
                <>
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
                  {basis && (
                    <details className="mt-1 mb-2 rounded-md border border-border-default bg-surface-muted px-3 py-2">
                      <summary className="cursor-pointer text-caption uppercase tracking-wide text-muted">
                        What this is based on
                      </summary>
                      <p className="mt-2 text-caption text-muted">
                        The interest note Scout used to research this topic. Edit
                        it from “Edit interests”.
                      </p>
                      <div className="scout-md mt-2 text-body-sm">
                        <ReactMarkdown
                          components={{
                            // Render the intent doc as plain, safe markdown —
                            // links open in a new tab; no citation/Chip logic
                            // (this is the reader's own note, not brief sources).
                            a: ({ href, children: c }) =>
                              href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline"
                                >
                                  {c}
                                </a>
                              ) : (
                                <>{c}</>
                              ),
                          }}
                        >
                          {basis}
                        </ReactMarkdown>
                      </div>
                    </details>
                  )}
                </>
              );
            },
            code: ({ children, className }) => {
              // Each story bullet leads with its publish date as `YYYY-MM-DD`
              // (or `undated`) — render that token as a prominent date badge so
              // freshness is visible per item (PER-176). Other inline code is
              // left as-is.
              const text = nodeToString(children).trim();
              const isDate = /^\d{4}-\d{2}-\d{2}$/.test(text) || text === "undated";
              if (isDate && !className) {
                return (
                  <span className="mr-1 inline-flex items-center rounded-pill border border-border-default bg-surface-muted px-2 py-0.5 text-caption font-medium uppercase tracking-wide text-muted tabular-nums">
                    {text === "undated" ? "undated" : formatDate(text)}
                  </span>
                );
              }
              return <code className={className}>{children}</code>;
            },
            a: ({ href, children }) => {
              if (!href) return <>{children}</>;
              const entry = citationByUrl.get(canonicalUrl(href));
              const label = nodeToString(children).trim();
              const isBareUrl = label === href || label === "";
              if (entry) {
                return (
                  <Chip
                    href={entry.article.url}
                    favicon={entry.favicon}
                    index={entry.index}
                  >
                    {isBareUrl ? entry.hostname : label}
                  </Chip>
                );
              }
              const host = hostname(href);
              return (
                <Chip href={href} favicon={faviconFor(host)}>
                  {isBareUrl ? host : label}
                </Chip>
              );
            },
          }}
        >
          {brief.markdown}
        </ReactMarkdown>
      </div>

      <details
        open
        className="rounded-md border border-border-default bg-surface-muted p-3"
      >
        <summary className="cursor-pointer text-caption uppercase tracking-wide text-muted">
          Sources ({brief.articles.length})
        </summary>
        <ol className="mt-3 flex flex-col gap-2 list-none p-0">
          {citations.map((c) => (
            <li
              key={c.article.id}
              className="flex items-baseline gap-2 text-body-sm text-secondary"
            >
              <span className="w-6 shrink-0 text-right font-medium text-primary tabular-nums">
                [{c.index}]
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <a
                  className="text-primary underline"
                  href={c.article.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.article.title || c.article.url}
                </a>
                <span className="text-muted">{c.hostname}</span>
                {c.article.publishedAt && (
                  <span className="text-caption text-muted">
                    · {formatDate(c.article.publishedAt)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function buildCitations(brief: Brief): CitationEntry[] {
  const urlSet = new Set(brief.articles.map((a) => canonicalUrl(a.url)));
  const referenced = new Set<string>();
  const re = /https?:\/\/[^\s)\]]+/g;
  for (const m of brief.markdown.matchAll(re)) {
    const c = canonicalUrl(m[0]);
    if (urlSet.has(c)) referenced.add(c);
  }

  const orderedArticles = [
    ...brief.articles.filter((a) => referenced.has(canonicalUrl(a.url))),
    ...brief.articles.filter((a) => !referenced.has(canonicalUrl(a.url))),
  ];

  const seen = new Set<string>();
  const order: CitationEntry[] = [];
  for (const a of orderedArticles) {
    const key = canonicalUrl(a.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const host = hostname(a.url);
    order.push({
      index: order.length + 1,
      article: a,
      hostname: host,
      favicon: faviconFor(host),
    });
  }
  return order;
}

function faviconFor(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return u;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
