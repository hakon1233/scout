"use client";

import * as React from "react";
import type { Article, Brief } from "@/lib/types";

// News-feed presentation of a brief (PER-211). Replaces the sectioned-markdown
// BriefView as the default home view: each story is a card with a headline, one
// short blurb, and — where the research run handpicked one from the source — a
// lead image. Clicking a card opens a still-short in-page detail with the source
// link(s) and image. Back returns to the feed via history (no route change: the
// companion serves only the `/app/` shell, so detail is in-page state, not a
// real export route).

type FeedItem = {
  id: string;
  headline: string;
  blurb?: string;
  // In-depth write-up shown ONLY in the detail view (PER-214). A few concise
  // paragraphs (`\n\n`-separated); absent when the story had nothing deeper.
  body?: string;
  imageUrl?: string;
  url: string;
  source: string;
  topic: string;
  publishedAt?: string;
};

export function FeedView({
  brief,
  onDetailOpenChange,
}: {
  brief: Brief;
  // PER-222: notify the page when a single-story detail opens/closes so it can
  // hide everything else (brief header, coverage banners, the history pager) and
  // render ONLY the focused story. The feed itself already swaps grid→detail; the
  // surrounding page chrome is what made "the rest of the feed" show below it.
  onDetailOpenChange?: (open: boolean) => void;
}) {
  const items = React.useMemo(() => buildFeed(brief.articles), [brief.articles]);

  // PER-219: the per-topic filter chips were removed from the feed — the founder
  // wanted a clean read straight into headlines, no filter UI. The chip logic
  // (a `topics` memo + `activeTopic` state + the `FilterChip` component + the
  // chip render block) is intentionally gone, not just hidden, so the feed has
  // one obvious reading order. To reintroduce later: derive topics from `items`,
  // hold an `activeTopic` state, and filter `items` by it before the grid map.

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // No reset effect on brief change is needed: a stale selection resolves to null
  // because story ids embed the brief id, so a previous edition's selectedId
  // never matches a new brief's items.

  // Close the detail on browser/OS Back. openDetail() pushes one history entry;
  // Back (hardware, gesture, or our in-app button via history.back()) pops it and
  // this fires — an in-app SPA transition with no landing flash (PER-206/209).
  React.useEffect(() => {
    const onPop = () => setSelectedId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const selected = selectedId
    ? items.find((it) => it.id === selectedId) ?? null
    : null;
  const detailOpen = selected != null;

  // PER-222: tell the page when we're in single-story mode so it can drop the
  // brief header, banners, and history pager — leaving only this one story.
  React.useEffect(() => {
    onDetailOpenChange?.(detailOpen);
  }, [detailOpen, onDetailOpenChange]);

  // PER-222 (AC2): remember where the feed was scrolled so Back lands the reader
  // back on the story they came from. Opening a story jumps to the top (the
  // dedicated page starts at its headline); closing restores the saved offset.
  const feedScrollY = React.useRef(0);
  React.useLayoutEffect(() => {
    if (detailOpen) {
      window.scrollTo(0, 0);
    } else if (feedScrollY.current > 0) {
      window.scrollTo(0, feedScrollY.current);
    }
  }, [detailOpen]);

  function openDetail(id: string) {
    feedScrollY.current = window.scrollY;
    setSelectedId(id);
    try {
      window.history.pushState({ scoutFeedDetail: id }, "");
    } catch {
      // pushState can throw in rare sandboxed contexts — detail still opens,
      // it just won't be tied to the Back button. Provide the in-app Back button.
    }
  }

  function closeDetail() {
    const state = window.history.state as { scoutFeedDetail?: string } | null;
    if (state?.scoutFeedDetail) {
      window.history.back(); // pops our pushed entry → popstate closes it
    } else {
      setSelectedId(null);
    }
  }

  if (selected) {
    return <FeedDetail item={selected} onBack={closeDetail} />;
  }

  if (items.length === 0) {
    // No parseable stories (e.g. every section reported `_no fresh news_`). The
    // page-level coverage banners already explain why; keep the feed area quiet.
    return (
      <p className="text-body-sm text-muted">
        No stories in this edition yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2">
        {items.map((it) => (
          <FeedCard key={it.id} item={it} onOpen={() => openDetail(it.id)} />
        ))}
      </div>
    </div>
  );
}

function FeedCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col overflow-hidden rounded-md border border-border-default bg-surface text-left transition hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {item.imageUrl && (
        <FeedImage
          src={item.imageUrl}
          className="aspect-[16/9] w-full object-cover"
        />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption uppercase tracking-wide text-muted">
          <span className="font-medium text-signal">{item.topic}</span>
          {item.publishedAt && (
            <span className="tabular-nums">· {formatDate(item.publishedAt)}</span>
          )}
        </div>
        <h3 className="font-serif text-title-3 leading-snug text-primary line-clamp-3">
          {item.headline}
        </h3>
        {item.blurb && (
          <p className="font-reading text-body-sm text-secondary line-clamp-2">
            {item.blurb}
          </p>
        )}
        <span className="mt-auto pt-1 text-caption text-muted">{item.source}</span>
      </div>
    </button>
  );
}

function FeedDetail({ item, onBack }: { item: FeedItem; onBack: () => void }) {
  return (
    <article className="flex flex-col gap-5">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-body-sm text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ← Back to feed
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption uppercase tracking-wide text-muted">
          <span className="font-medium text-signal">{item.topic}</span>
          {item.publishedAt && (
            <span className="tabular-nums">· {formatDate(item.publishedAt)}</span>
          )}
        </div>
        <h1 className="font-serif text-title-1 leading-tight text-primary">
          {item.headline}
        </h1>
      </div>

      {item.imageUrl && (
        <FeedImage
          src={item.imageUrl}
          className="w-full rounded-md object-cover"
        />
      )}

      {item.blurb && (
        <p className="font-reading text-body font-medium text-primary">
          {item.blurb}
        </p>
      )}

      {item.body && (
        <div className="flex flex-col gap-4">
          {item.body.split(/\n{2,}/).map((para, i) => (
            <p
              key={i}
              className="font-reading text-body leading-relaxed text-secondary"
            >
              {para}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border-default bg-surface-muted p-4">
        <p className="text-caption uppercase tracking-wide text-muted">Source</p>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-body-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          <img
            src={faviconFor(item.source)}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 rounded-sm"
            loading="lazy"
          />
          Read the full story at {item.source} ↗
        </a>
      </div>
    </article>
  );
}

// Source images are external (and best-effort handpicked by the model). On any
// load error — paywall, hotlink block, 404, blocked URL — drop the image so the
// card/detail degrade to clean text rather than showing a broken-image icon.
function FeedImage({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  // Remote, unknown-host source images — next/image needs preconfigured domains
  // we can't predict, so a plain <img> with graceful onError is correct here.
  // referrerPolicy="no-referrer" so referer-checking CDNs (Crunchbase etc.) that
  // 403 a request carrying our ts.net origin still serve the image (PER-217).
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

// Turn the parsed articles into deduped, newest-first feed items. Headline comes
// from the citation label (`domain — Title` → Title); blurb is the story's
// one-sentence summary captured by the parser; imageUrl is the handpicked source
// image (may be absent → text-only card).
function buildFeed(articles: Article[]): FeedItem[] {
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const a of articles) {
    const key = canonicalUrl(a.url);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: a.id,
      headline: deriveHeadline(a.title, a.url),
      blurb: a.text,
      body: a.body,
      imageUrl: a.imageUrl,
      url: a.url,
      source: a.source ?? hostname(a.url),
      topic: a.interest,
      publishedAt: a.publishedAt,
    });
  }

  // Stable newest-first: dated items by date desc, then undated in document order.
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ta = dateValue(a.it.publishedAt);
      const tb = dateValue(b.it.publishedAt);
      if (ta !== null && tb !== null) return tb - ta || a.i - b.i;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return a.i - b.i;
    })
    .map(({ it }) => it);
}

// `domain — Title` → `Title`. The search-skills citation contract is
// `[domain — Title](url)`; strip the leading domain segment so the card shows the
// real headline. Falls back to the whole label when there's no `—` separator, or
// when the part before it doesn't look like the source domain.
function deriveHeadline(label: string, url: string): string {
  const parts = label.split(/\s+—\s+/);
  if (parts.length >= 2) {
    const lead = parts[0].trim().toLowerCase();
    const host = hostname(url).toLowerCase();
    const looksLikeDomain =
      /\.[a-z]{2,}$/.test(lead) || host.includes(lead) || lead.includes(host);
    if (looksLikeDomain) return parts.slice(1).join(" — ").trim();
  }
  return label.trim();
}

function dateValue(d?: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconFor(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
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
