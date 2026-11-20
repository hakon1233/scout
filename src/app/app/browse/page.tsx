"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useHostedData } from "@/hooks/useHostedData";
import { PickCards, usePicks } from "@/components/PickCards";
import { PushBell } from "@/components/PushBell";
import { ReportLink } from "@/components/ReportSheet";
import {
  AppShell,
  PageHeader,
  newTopicHref,
} from "@/components/shell/AppShell";
import { TagChip, useTagCounts } from "@/components/TagPicker";
import { Button, NoticeCard, buttonClasses } from "@/components/ui";
import { useBackLink } from "@/hooks/useSignedIn";
import { useTopicPush } from "@/hooks/useTopicPush";
import { hostedAuth } from "@/lib/auth";
import { HostedError, type HostedData, type TopicCard } from "@/lib/hosted";
import { followersLabel } from "@/lib/publish-flow";
import { parseShareLink } from "@/lib/share-link";
import { cleanTag, popularTags } from "@/lib/tag-picker";

// Browse: the public catalog, signed in or out. A search (or a pasted share
// link), tag chips, then popular or new topics with Follow and the bell.
// Signed out it reads the same; Follow asks to sign in. The view lives in
// the URL (?q, ?tag, ?sort), so reload and Back keep it.
export default function BrowsePage() {
  const back = useBackLink(
    { href: "/app/", label: "Brief" },
    { href: "/", label: "Home" },
  );
  return (
    <AppShell>
      <PageHeader title="Browse" back={back}>
        Public topics anyone can follow. Following is free.
      </PageHeader>
      <React.Suspense fallback={<ResultsSkeleton />}>
        <Browse />
      </React.Suspense>
    </AppShell>
  );
}

type Results =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; cards: TopicCard[] };

/** Ids of the reader's topics: the ones they follow and their own. */
type Mine = { following: ReadonlySet<string>; own: ReadonlySet<string> };
const NONE: Mine = { following: new Set(), own: new Set() };

function Browse() {
  const data = useHostedData();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = params.get("q") ?? "";
  const tags = params.getAll("tag");
  const sort = params.get("sort") === "new" ? "new" : "popular";
  const [text, setText] = React.useState(q);
  const [results, setResults] = React.useState<Results>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [signedIn, setSignedIn] = React.useState(false);
  const [mine, setMine] = React.useState<Mine>(NONE);
  const [moreTags, setMoreTags] = React.useState(false);
  const counts = useTagCounts(data);
  const push = useTopicPush(signedIn ? data : null);
  const picks = usePicks(signedIn ? data : null);
  const tagKey = tags.join(",");

  const go = React.useCallback(
    (change: { q?: string; tags?: string[]; sort?: string }) => {
      const next = new URLSearchParams();
      const nq = change.q ?? q;
      if (nq.trim()) next.set("q", nq.trim());
      for (const t of change.tags ?? tags) next.append("tag", t);
      const ns = change.sort ?? sort;
      if (ns !== "popular") next.set("sort", ns);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tagKey stands for tags
    [q, tagKey, sort, pathname, router],
  );

  // Who is reading, and which topics they already have.
  React.useEffect(() => {
    if (!data) return;
    let live = true;
    void (async () => {
      const user = await hostedAuth()
        ?.currentUser()
        .catch(() => null);
      if (!live || !user) return;
      setSignedIn(true);
      try {
        const home = await data.home();
        if (!live) return;
        setMine({
          following: new Set(
            home.interests.filter((i) => i.following).map((i) => i.id),
          ),
          own: new Set(
            home.interests.filter((i) => !i.following).map((i) => i.id),
          ),
        });
      } catch {
        // Without the reader's topics every card offers Follow; following
        // one twice is harmless.
      }
    })();
    return () => {
      live = false;
    };
  }, [data]);

  // The search box writes the URL a moment after typing stops.
  React.useEffect(() => {
    if (text === q || parseShareLink(text)) return;
    const timer = setTimeout(() => go({ q: text }), 300);
    return () => clearTimeout(timer);
  }, [text, q, go]);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new query
    setResults({ kind: "loading" });
    data
      .browse({ q, tags: tagKey ? tagKey.split(",") : [], sort, limit: 24 })
      .then(
        (cards) => live && setResults({ kind: "ready", cards }),
        (err) =>
          live &&
          setResults({
            kind: "failed",
            message:
              err instanceof HostedError
                ? err.message
                : "Couldn't load public topics.",
          }),
      );
    return () => {
      live = false;
    };
  }, [data, q, tagKey, sort, attempt]);

  if (!data)
    return (
      <div data-main>
        <NoticeCard label="Hosted Scout only" tone="neutral">
          Public topics live on Scout&rsquo;s hosted app. This copy runs on your
          own computer, so here you{" "}
          <Link href={newTopicHref()} className="font-medium underline">
            start your own
          </Link>
          .
        </NoticeCard>
      </div>
    );

  const link = parseShareLink(text);
  const chips = popularTags(counts, moreTags ? 40 : 12);
  const shownChips = [...tags.filter((t) => !chips.includes(t)), ...chips];

  async function follow(card: TopicCard) {
    try {
      const id = await data!.follow(card.slug);
      setMine((m) => ({
        ...m,
        following: new Set([...m.following, id, card.id]),
      }));
    } catch (err) {
      if (err instanceof HostedError && err.kind === "signed-out") {
        router.push("/app/signin/");
        return;
      }
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (link) router.push(`/i/?s=${link}`);
            else go({ q: text });
          }}
        >
          <label htmlFor="browse-search" className="sr-only">
            Search topics or paste a link
          </label>
          <input
            id="browse-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search topics or paste a link"
            autoComplete="off"
            enterKeyHint="search"
            className="min-h-11 w-full rounded-[12px] border border-border-strong bg-surface px-3 text-base text-primary placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </form>
        {link ? (
          <Link
            href={`/i/?s=${link}`}
            className="flex min-h-11 items-center justify-between gap-3 rounded-[12px] bg-surface-muted px-3 text-body-sm font-medium text-primary hover:underline"
          >
            Open the shared topic
            <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <div
            role="group"
            aria-label="Filter by tag"
            className="flex flex-wrap gap-2"
          >
            {shownChips.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                pressed={tags.includes(tag)}
                onClick={() =>
                  go({
                    tags: tags.includes(tag)
                      ? tags.filter((t) => t !== tag)
                      : [...tags, cleanTag(tag) ?? tag],
                  })
                }
              />
            ))}
            {!moreTags && counts.length > 12 && (
              <button
                type="button"
                onClick={() => setMoreTags(true)}
                className="min-h-9 rounded-pill px-3 text-body-sm text-secondary underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring phone:min-h-11"
              >
                More tags
              </button>
            )}
          </div>
        )}
      </div>

      {!q && tags.length === 0 && !link && <PickCards picks={picks} max={6} />}

      <section className="flex flex-col gap-2" aria-labelledby="browse-list">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 id="browse-list" className="text-body-sm text-muted">
            {q || tags.length ? "Results" : "Public topics"}
          </h2>
          <div
            role="radiogroup"
            aria-label="Sort"
            className="flex items-center gap-1"
          >
            {(["popular", "new"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sort === s}
                onClick={() => go({ sort: s })}
                className={`min-h-9 rounded-pill px-3 text-body-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring phone:min-h-11 ${
                  sort === s
                    ? "bg-surface-muted font-medium text-primary"
                    : "text-muted hover:text-primary"
                }`}
              >
                {s === "popular" ? "Popular" : "New"}
              </button>
            ))}
          </div>
        </div>
        <div data-main>
          {results.kind === "loading" ? (
            <ResultsSkeleton />
          ) : results.kind === "failed" ? (
            <div className="flex flex-col items-start gap-3 rounded-card border border-border-default bg-surface p-4">
              <p role="alert" className="text-body-sm text-danger">
                {results.message}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttempt((a) => a + 1)}
              >
                Try again
              </Button>
            </div>
          ) : results.cards.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-card border border-border-default bg-surface p-4">
              <p className="text-body-sm text-secondary">
                Nothing public matches. Try a broader word, or make your own.
              </p>
              <Link
                href={newTopicHref()}
                className={buttonClasses("secondary", "sm")}
              >
                New topic
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-surface">
              {results.cards.map((card) => (
                <BrowseRow
                  key={card.id}
                  card={card}
                  data={data}
                  signedIn={signedIn}
                  following={mine.following.has(card.id)}
                  own={mine.own.has(card.id)}
                  push={push}
                  onFollow={() => follow(card)}
                  onTag={(tag) =>
                    !tags.includes(tag) && go({ tags: [...tags, tag] })
                  }
                />
              ))}
            </ul>
          )}
        </div>
        {push.error && (
          <p role="alert" className="px-1 text-body-sm text-danger">
            {push.error}
          </p>
        )}
      </section>
    </div>
  );
}

function BrowseRow({
  card,
  data,
  signedIn,
  following,
  own,
  push,
  onFollow,
  onTag,
}: {
  card: TopicCard;
  data: HostedData;
  signedIn: boolean;
  following: boolean;
  own: boolean;
  push: ReturnType<typeof useTopicPush>;
  onFollow: () => Promise<void>;
  onTag: (tag: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const by = card.team
    ? "Scout team"
    : card.ownerName
      ? `By ${card.ownerName}`
      : null;
  const meta = [by, followersLabel(card.followers)].filter(Boolean).join(" · ");

  return (
    <li className="flex flex-col gap-2 py-3 pl-4 pr-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/i/?s=${card.slug}`}
            className="block break-words text-body font-medium text-primary hover:underline"
          >
            {card.title}
          </Link>
          <p className="text-body-sm text-muted tabular-nums">{meta}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {(following || own) && signedIn && (
            <PushBell
              topic={card.title}
              on={push.isOn(card.id)}
              onChange={(on) => push.set(card.id, on)}
              deviceOn={push.deviceOn}
              blocked={push.blocked}
            />
          )}
          {own ? (
            <span className="px-2 text-body-sm text-muted">Yours</span>
          ) : following ? (
            <span className="px-2 text-body-sm text-muted">Following</span>
          ) : signedIn ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                onFollow()
                  .catch((err: unknown) =>
                    setError(
                      err instanceof HostedError
                        ? err.message
                        : "Couldn't follow it. Try again.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Follow
            </Button>
          ) : (
            <Link
              href="/app/signin/"
              className={buttonClasses("secondary", "sm")}
            >
              Sign in to follow
            </Link>
          )}
        </span>
      </div>
      {(card.tags.length > 0 || (signedIn && !own)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {card.tags.slice(0, 3).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTag(tag)}
              className="min-h-6 rounded text-caption text-secondary hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              #{tag}
            </button>
          ))}
          {signedIn && !own && (
            <span className="-mr-2 ml-auto">
              <ReportLink data={data} interestId={card.id} topic={card.title} />
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

function ResultsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-surface"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-4">
          <span className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
          <span className="h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}
