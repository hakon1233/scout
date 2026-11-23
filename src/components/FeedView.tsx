"use client";

import * as React from "react";
import { useTabTitle } from "@/hooks/useTabTitle";
import dynamic from "next/dynamic";
import type { Article, Brief } from "@/lib/types";
import { canonicalUrl } from "@scout/core";
import type { LikeInput } from "@/lib/likes";
import { LikeButton, SaveButton } from "@/components/LikeButton";
import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format-date";
import { usage } from "@/lib/usage";

// react-markdown + rehype-sanitize (~170KB) are only needed by the
// single-story detail body, which never mounts until a reader opens a card.
// Lazy-load it so the markdown pipeline is split out of the /app feed's initial
// JS and fetched on first detail open. A short text placeholder holds the spot
// while the chunk loads (sub-second on a normal connection).
const FeedBody = dynamic(() => import("@/components/FeedBody"), {
  loading: () => <p className="font-reading text-body text-muted">…</p>,
});

// News-feed presentation of a brief. Replaces the sectioned-markdown
// BriefView as the default home view: each story is a card with a headline, one
// short blurb, and — where the research run handpicked one from the source — a
// lead image. Clicking a card opens a still-short in-page detail with the source
// link(s) and image. The open story is a `?story=<id>` query on the same page
// (the companion serves only the `/app/` shell, so there is no export route per
// story); Back returns to the feed via history.

type FeedItem = {
  id: string;
  headline: string;
  blurb?: string;
  // In-depth write-up shown ONLY in the detail view. A few concise
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
  backLabel = "Back to feed",
}: {
  brief: Brief;
  // The open story's way back names the page it was opened from.
  backLabel?: string;
  // Notify the page when a single-story detail opens/closes so it can
  // hide everything else (brief header, coverage banners, the history pager) and
  // render ONLY the focused story. The feed itself already swaps grid→detail; the
  // surrounding page chrome is what made "the rest of the feed" show below it.
  onDetailOpenChange?: (open: boolean) => void;
}) {
  const items = React.useMemo(
    () => buildFeed(brief.articles),
    [brief.articles],
  );

  // The per-topic filter chips were removed from the feed — the reader gets a
  // clean read straight into headlines, no filter UI. The chip logic
  // (a `topics` memo + `activeTopic` state + the `FilterChip` component + the
  // chip render block) is intentionally gone, not just hidden, so the feed has
  // one obvious reading order. To reintroduce later: derive topics from `items`,
  // hold an `activeTopic` state, and filter `items` by it before the grid map.

  // The open story lives in the URL (`?story=<id>`), so reload, Back and a
  // shared link keep it. A stale id (a previous edition's) resolves to null
  // because story ids embed the brief id.
  const selectedId = React.useSyncExternalStore(
    subscribeStoryParam,
    storyParam,
    () => null,
  );

  const selected = selectedId
    ? (items.find((it) => it.id === selectedId) ?? null)
    : null;
  const detailOpen = selected != null;
  useTabTitle(selected?.headline);

  // Hosted and signed in only (usage is a no-op until startUsage): the brief
  // was seen, and which story is open for how long.
  React.useEffect(() => {
    usage.briefViewed(
      brief.id,
      brief.articles.map((a) => a.interest),
    );
  }, [brief]);
  const openTopic = selected?.topic;
  const openUrl = selected?.url;
  React.useEffect(() => {
    if (!openTopic || !openUrl) return;
    usage.storyOpened(openTopic, openUrl);
    return () => usage.storyClosed();
  }, [openTopic, openUrl]);

  // Tell the page when we're in single-story mode so it can drop the
  // brief header, banners, and history pager — leaving only this one story.
  React.useEffect(() => {
    onDetailOpenChange?.(detailOpen);
  }, [detailOpen, onDetailOpenChange]);

  // Remember where the feed was scrolled so Back lands the reader
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
    try {
      window.history.pushState({ scoutFeedDetail: id }, "", storyHref(id));
    } catch {
      // pushState can throw in rare sandboxed contexts: the story just won't
      // open from the URL.
    }
    notifyStoryParam();
  }

  function closeDetail() {
    const state = window.history.state as { scoutFeedDetail?: string } | null;
    if (state?.scoutFeedDetail) {
      window.history.back(); // pops our pushed entry → popstate closes it
      return;
    }
    // Opened from a reload or a shared link: drop the param in place.
    try {
      window.history.replaceState(window.history.state, "", storyHref(null));
    } catch {
      // Nothing to undo.
    }
    notifyStoryParam();
  }

  if (selected) {
    return (
      <FeedDetail item={selected} onBack={closeDetail} backLabel={backLabel} />
    );
  }

  if (items.length === 0) {
    // No parseable stories (e.g. every section reported `_no fresh news_`). The
    // page-level coverage banners already explain why; use the shared empty-state
    // primitive so this reads consistently with every other "nothing here yet"
    // surface in the app (Liked feed, interest docs, etc.) instead of a bare line.
    return <EmptyState title="No stories in this edition yet" />;
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

// Map a feed item to the display snapshot we persist when it's liked.
function likeInputFor(item: FeedItem): LikeInput {
  return {
    url: item.url,
    headline: item.headline,
    blurb: item.blurb,
    source: item.source,
    topic: item.topic,
    imageUrl: item.imageUrl,
    publishedAt: item.publishedAt,
  };
}

function FeedCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  // One story per card. The headline's button stretches over the whole card
  // (its ::after covers it), so a tap anywhere opens the story, while the heart
  // in the foot sits above that layer as its own button: a <button> inside a
  // <button> is invalid HTML. A headline may wrap; the card allows it.
  return (
    <article
      data-allow-wrap
      className="relative flex flex-col overflow-hidden rounded-card border border-border-default bg-surface transition focus-within:ring-2 focus-within:ring-focus-ring hover:border-border-strong"
    >
      {item.imageUrl && (
        <FeedImage
          src={item.imageUrl}
          className="aspect-[16/9] w-full object-cover"
        />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-caption font-medium text-secondary">{item.topic}</p>
        <h3 className="font-serif text-title-3 leading-snug text-primary text-balance">
          <button
            type="button"
            onClick={onOpen}
            className="text-left after:absolute after:inset-0 after:content-[''] focus:outline-none"
          >
            {item.headline}
          </button>
        </h3>
        {item.blurb && (
          <p className="font-reading text-body text-secondary line-clamp-3">
            {item.blurb}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 text-body-sm text-muted">
          <span className="min-w-0 truncate tabular-nums">
            {item.source}
            {item.publishedAt && <> · {formatDate(item.publishedAt)}</>}
          </span>
          {item.url && (
            <LikeButton story={likeInputFor(item)} className="relative z-10" />
          )}
        </div>
      </div>
    </article>
  );
}

function FeedDetail({
  item,
  onBack,
  backLabel,
}: {
  item: FeedItem;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <article className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-body-sm text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ← {backLabel}
        </button>
        {item.url && (
          <span className="flex items-center gap-2">
            <SaveButton story={likeInputFor(item)} />
            <LikeButton story={likeInputFor(item)} />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
          <span className="font-medium uppercase tracking-wide text-signal">
            {item.topic}
          </span>
          {item.publishedAt && (
            <span className="uppercase tracking-wide tabular-nums">
              · {formatDate(item.publishedAt)}
            </span>
          )}
          <span className="rounded-pill border border-border-default px-2 py-0.5 text-secondary">
            Written by AI
          </span>
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

      {item.body && <FeedBody markdown={item.body} />}

      {item.url && (
        <div className="flex flex-col gap-2 rounded-md border border-border-default bg-surface-muted p-4">
          <p className="text-caption uppercase tracking-wide text-muted">
            Source
          </p>
          <a
            href={item.url}
            target="_blank"
            rel="nofollow ugc noopener"
            className="inline-flex items-center gap-2 text-body-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            <SourceBadge host={hostname(item.url)} />
            Read the full story at {hostname(item.url)} ↗
          </a>
        </div>
      )}
    </article>
  );
}

// Source images are external (and best-effort handpicked by the model). On any
// load error — paywall, hotlink block, 404, blocked URL — drop the image so the
// card/detail degrade to clean text rather than showing a broken-image icon.
export function FeedImage({
  src,
  className,
}: {
  src: string;
  className: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  // Remote, unknown-host source images — next/image needs preconfigured domains
  // we can't predict, so a plain <img> with graceful onError is correct here.
  // referrerPolicy="no-referrer" so referer-checking CDNs (Crunchbase etc.) that
  // 403 a request carrying our proxy origin still serve the image.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Arbitrary source images need no-referrer and graceful unknown-host fallback; next/image requires host policy we cannot predict.
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
    // A piece Scout wrote (no url) is its own item: there is no link to dedupe on.
    const key = a.url ? canonicalUrl(a.url) : `piece:${a.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: a.id,
      headline: a.url ? deriveHeadline(a.title, a.url) : a.title,
      blurb: a.text,
      body: a.body,
      imageUrl: a.imageUrl,
      url: a.url,
      source: a.source ?? (a.url ? hostname(a.url) : "Scout"),
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

// A letter tile for the story's source. Drawn locally, so showing a feed never
// tells a favicon service which sites you read.
export function SourceBadge({ host }: { host: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-surface-muted text-caption font-semibold uppercase leading-none text-muted"
    >
      {host.replace(/^www\./, "").charAt(0)}
    </span>
  );
}

// The canonical date formatter now lives in `@/lib/format-date` so the brief
// surfaces share one timezone-safe implementation (imported above). Re-exported
// here so existing `@/components/FeedView` importers (e.g. the liked-stories
// page) are unchanged.
export { formatDate };

// --- the open story in the URL ----------------------------------------------

const storyListeners = new Set<() => void>();

function subscribeStoryParam(fn: () => void): () => void {
  storyListeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    storyListeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}

function notifyStoryParam(): void {
  for (const fn of storyListeners) fn();
}

function storyParam(): string | null {
  return new URLSearchParams(window.location.search).get("story");
}

/** This page's URL with `story` set to `id`, or without it. */
function storyHref(id: string | null): string {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("story", id);
  else url.searchParams.delete("story");
  return `${url.pathname}${url.search}${url.hash}`;
}
