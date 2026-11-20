"use client";

import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui";
import { HostedError, type HostedData, type PickCard } from "@/lib/hosted";

// Topics Scout picked for the reader (one cached ranking, refreshed weekly):
// the weekly suggestions on the feed and "Picked for you" in Browse, as one
// short list. Each row says why it was picked, offers Follow, and can be crossed out
// ("Not for me"), which Scout remembers. Renders nothing without picks.

type Picks = {
  cards: PickCard[];
  followed: ReadonlySet<string>;
  error: string | null;
  dismiss: (id: string) => void;
  follow: (card: PickCard) => Promise<void>;
};

/** Loads the reader's picks; `data` is null when signed out. */
export function usePicks(
  data: HostedData | null,
  onSignedOut?: (err: unknown) => boolean,
): Picks {
  const [cards, setCards] = React.useState<PickCard[]>([]);
  const [followed, setFollowed] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    data.picks().then(
      (p) => live && setCards(p),
      // Picks are extra; without them the page reads the same.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data]);

  const dismiss = React.useCallback(
    (id: string) => {
      if (!data) return;
      const before = cards;
      setCards((c) => c.filter((p) => p.id !== id));
      setError(null);
      data.dismissPick(id).catch((err) => {
        setCards(before);
        if (!onSignedOut?.(err))
          setError(
            err instanceof HostedError
              ? err.message
              : "Couldn't hide that pick. Try again.",
          );
      });
    },
    [data, cards, onSignedOut],
  );

  const follow = React.useCallback(
    async (card: PickCard) => {
      if (!data) return;
      setError(null);
      try {
        await data.follow(card.slug);
        setFollowed((f) => new Set([...f, card.id]));
      } catch (err) {
        if (!onSignedOut?.(err))
          setError(
            err instanceof HostedError
              ? err.message
              : "Couldn't follow it. Try again.",
          );
      }
    },
    [data, onSignedOut],
  );

  return { cards, followed, error, dismiss, follow };
}

/** Up to `max` picks under a "Picked for you" heading, one row each. */
export function PickCards({ picks, max }: { picks: Picks; max: number }) {
  const headingId = React.useId();
  const shown = picks.cards.slice(0, max);
  if (shown.length === 0 && !picks.error) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId}>
      <h2 id={headingId} className="px-1 text-body-sm text-muted">
        Picked for you
      </h2>
      {shown.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-surface">
          {shown.map((p) => (
            <PickRow
              key={p.id}
              pick={p}
              following={picks.followed.has(p.id)}
              onFollow={() => picks.follow(p)}
              onDismiss={() => picks.dismiss(p.id)}
            />
          ))}
        </ul>
      )}
      {picks.error && (
        <p role="alert" className="px-1 text-body-sm text-danger">
          {picks.error}
        </p>
      )}
    </section>
  );
}

function PickRow({
  pick,
  following,
  onFollow,
  onDismiss,
}: {
  pick: PickCard;
  following: boolean;
  onFollow: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <li className="flex items-center gap-2 py-3 pl-4 pr-1">
      <div className="min-w-0 flex-1">
        <Link
          href={`/i/?s=${pick.slug}`}
          className="tap-target block break-words text-body font-medium text-primary underline-offset-2 hover:underline"
        >
          {pick.title}
        </Link>
        <p className="text-body-sm text-muted">{pick.reason}</p>
      </div>
      {following ? (
        <span className="px-2 text-body-sm text-muted">Following</span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void onFollow().finally(() => setBusy(false));
          }}
        >
          Follow
        </Button>
      )}
      <button
        type="button"
        aria-label={`Not for me: ${pick.title}`}
        title="Not for me"
        onClick={onDismiss}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}
