"use client";

import * as React from "react";
import { NoticeCard } from "@/components/ui/NoticeCard";
import { takeHomeScreenTurn, type HomeScreenDevice } from "@/lib/home-screen";
import { splitNotices, type FeedNotice } from "@/lib/feed-notices";
import { formatDate } from "@/lib/format-date";

export type NoticeView = {
  notice: FeedNotice;
  label: string;
  tone: "bad" | "new" | "neutral";
  body: React.ReactNode;
  action?: React.ReactNode;
  onDismiss: () => void;
};

const SHOWN = 2;

// The notice-cards slot at the top of the feed: the first two notices, the
// rest behind "Show N more", then the Home Screen card when it is its turn.
export function FeedNotices({ items }: { items: NoticeView[] }) {
  const [all, setAll] = React.useState(false);
  const { shown, more } = splitNotices(
    items.map((i) => i.notice),
    all ? items.length : SHOWN,
  );
  const visible = items.filter((i) => shown.includes(i.notice));

  if (visible.length === 0) return <HomeScreenCard />;
  return (
    <section aria-label="Notices" className="flex flex-col gap-3">
      {visible.map((i) => (
        <NoticeCard
          key={i.notice.id}
          label={i.label}
          tone={i.tone}
          meta={i.notice.at ? formatDate(i.notice.at) : undefined}
          action={i.action}
          onDismiss={i.onDismiss}
          dismissLabel={`Dismiss: ${i.label}${i.notice.topic ? `, ${i.notice.topic}` : ""}`}
        >
          {i.body}
        </NoticeCard>
      ))}
      {more > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="self-start rounded-pill px-3 py-2 text-body-sm font-medium text-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Show {more} more
        </button>
      )}
      <HomeScreenCard />
    </section>
  );
}

/** "Add Scout to your Home Screen": phones only, once a week, until installed. */
export function HomeScreenCard() {
  const [device, setDevice] = React.useState<HomeScreenDevice | null>(null);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only read on mount
    setDevice(takeHomeScreenTurn());
  }, []);
  if (!device) return null;
  return (
    <NoticeCard
      label="Tip"
      onDismiss={() => setDevice(null)}
      dismissLabel="Dismiss: Add Scout to your Home Screen"
    >
      <p className="font-medium">Add Scout to your Home Screen</p>
      <p className="text-secondary">
        {device.iphone
          ? "Tap Share, then Add to Home Screen. It opens like an app and can notify you when a brief is ready."
          : "Open your browser's menu, then Install app or Add to Home screen. It opens like an app and can notify you when a brief is ready."}
      </p>
    </NoticeCard>
  );
}
