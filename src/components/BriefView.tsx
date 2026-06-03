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
  // Derive the filter chips from the brief's OWN `## ` section headings. This is
  // the single source of truth that guarantees every section the reader can see
  // has a matching filter and vice-versa (PER-191) — no separate, drift-prone
  // interest list. Selecting a chip narrows both the rendered markdown and the
  // sources list to exactly that section.
  const sections = React.useMemo(() => parseSections(brief.markdown), [brief.markdown]);
  const [activeSlug, setActiveSlug] = React.useState<string | null>(null);

  // Reset the filter whenever a new brief loads so a stale selection from the
  // previous brief never hides everything.
  React.useEffect(() => {
    setActiveSlug(null);
  }, [brief.id]);

  // Keep the active selection valid if the section set changes.
  const active =
    activeSlug && sections.some((s) => s.slug === activeSlug) ? activeSlug : null;

  const visibleMarkdown = React.useMemo(() => {
    if (!active) return brief.markdown;
    const sec = sections.find((s) => s.slug === active);
    return sec ? sec.body : brief.markdown;
  }, [active, sections, brief.markdown]);

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

  // When a section is selected, the sources panel narrows to that section's
  // articles (matched by interest slug, exact-then-fuzzy like sourceCountFor) so
  // the filter is honest end-to-end. Citation indices stay as built from the
  // full brief so a chip's [n] is stable whether or not a filter is applied.
  const visibleCitations = React.useMemo(() => {
    if (!active) return citations;
    return citations.filter((c) => slugMatches(active, slugify(c.article.interest)));
  }, [active, citations]);

  function sourceCountFor(headingText: string): number {
    const slug = slugify(headingText);
    if (countsByTopicSlug.has(slug)) return countsByTopicSlug.get(slug)!;
    for (const [k, v] of countsByTopicSlug) {
      if (slugMatches(slug, k)) return v;
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
      if (slugMatches(slug, k)) return v;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.length > 1 && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter brief by topic"
        >
          <button
            type="button"
            onClick={() => setActiveSlug(null)}
            aria-pressed={!active}
            className={filterPill(!active)}
          >
            All topics
          </button>
          {sections.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => setActiveSlug(s.slug)}
              aria-pressed={active === s.slug}
              className={filterPill(active === s.slug)}
            >
              <span className="max-w-[16ch] truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
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
                        The interest note Scout used to research this topic.
                        Manage it from your profile.
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
          {visibleMarkdown}
        </ReactMarkdown>
      </div>

      <details
        open
        className="rounded-md border border-border-default bg-surface-muted p-3"
      >
        <summary className="cursor-pointer text-caption uppercase tracking-wide text-muted">
          Sources ({visibleCitations.length})
        </summary>
        <ol className="mt-3 flex flex-col gap-2 list-none p-0">
          {visibleCitations.map((c) => (
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

// Exact-then-fuzzy slug equality, shared by the section filter and the per-topic
// count/basis lookups so a heading the model capitalized or pluralized slightly
// differently still lines up with its articles.
function slugMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

// Split a brief into its `## ` sections in document order. `body` is the full
// markdown for that section (heading line included) so rendering a single
// section reuses the exact same ReactMarkdown pipeline. Content before the first
// `## ` (a brief preamble, if any) is intentionally not a filterable chip.
function parseSections(markdown: string): { slug: string; label: string; body: string }[] {
  const lines = markdown.split("\n");
  const sections: { slug: string; label: string; body: string }[] = [];
  let current: { slug: string; label: string; body: string[] } | null = null;
  const headingRe = /^##\s+(?!#)(.+?)\s*$/;
  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m) {
      if (current) sections.push({ ...current, body: current.body.join("\n") });
      const label = m[1].trim();
      current = { slug: slugify(label), label, body: [line] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ ...current, body: current.body.join("\n") });

  // De-dupe by slug (a brief shouldn't repeat a topic, but be defensive so chips
  // never collide on React keys).
  const seen = new Set<string>();
  return sections.filter((s) => {
    if (!s.slug || seen.has(s.slug)) return false;
    seen.add(s.slug);
    return true;
  });
}

// Mirrors RunScopeSelector's pill styling so the brief filter reads as the same
// control family (same token set, focus ring, min tap target).
function filterPill(active: boolean): string {
  return [
    "inline-flex min-h-[44px] items-center rounded-pill border px-3 py-1.5 text-caption transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
    active
      ? "border-border-strong bg-surface-strong font-medium text-primary"
      : "border-border-default bg-surface text-muted hover:bg-surface-muted hover:text-secondary",
  ].join(" ");
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
