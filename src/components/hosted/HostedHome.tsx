"use client";

import * as React from "react";
import { AppSkeleton } from "@/components/AppSkeleton";
import { BriefLayout } from "@/components/BriefLayout";
import { FeedNotices, type NoticeView } from "@/components/FeedNotices";
import { PickCards, usePicks } from "@/components/PickCards";
import { AppShell } from "@/components/shell/AppShell";
import { ContactEmail } from "@/components/shell/DraftDocument";
import { TopicFilter } from "@/components/TopicFilter";
import { startUsage } from "@/lib/usage";
import { Banner, Button } from "@/components/ui";
import {
  dismissLocally,
  readDismissed,
  visibleNotices,
  type FeedNotice,
} from "@/lib/feed-notices";
import {
  HostedError,
  type HostedData,
  type HostedHome as Home,
  type NoticeKind,
} from "@/lib/hosted";
import { HostedChat } from "./HostedChat";
import { scheduleNew, useHostedHome } from "./useHostedHome";

// The signed-in hosted feed: notice cards and up to three picks, then the
// latest brief with a topic filter. Topics, sharing and schedules live on /app/topics. A reader with no
// topics lands straight in the setup chat.
export function HostedHome() {
  const {
    data,
    home,
    turns,
    loadError,
    reload,
    signedOut,
    send,
    confirm,
    transcribe,
  } = useHostedHome({ chat: true });

  // `data` is null only while prerendering (no window); the client's first
  // render must match it, so both show the skeleton.
  if (!data || !home) {
    return (
      <AppShell>
        {loadError ? (
          <div className="flex flex-col items-start gap-3" data-main>
            <p className="text-body text-danger">{loadError}</p>
            <Button variant="secondary" onClick={() => location.reload()}>
              Try again
            </Button>
          </div>
        ) : (
          <AppSkeleton />
        )}
      </AppShell>
    );
  }

  const firstRun = home.interests.length === 0;
  return (
    <AppShell menu={hostedMenu(home)}>
      {loadError && <Banner tone="danger">{loadError}</Banner>}
      {firstRun ? (
        <section className="flex flex-col gap-6" data-main>
          <div className="flex flex-col gap-2">
            <h1 className="font-serif text-title-1 text-balance">
              What do you want to follow?
            </h1>
            <p className="text-body text-secondary text-pretty">
              Tell Scout in your own words. It writes you a brief with the news
              that matters, every day or every week.
            </p>
          </div>
          <HostedChat
            turns={turns}
            send={send}
            confirm={confirm}
            transcribe={transcribe}
            label="Your topic"
            autoFocus
          />
        </section>
      ) : (
        <Feed data={data} home={home} reload={reload} signedOut={signedOut} />
      )}
    </AppShell>
  );
}

/** The menu's topic count and plan line, from the reader's home. */
export function hostedMenu(home: Home) {
  return {
    topicCount: home.interests.filter((i) => !i.following).length,
    plan: home.allowance.plan,
  };
}

const key = (t: string) => t.trim().toLowerCase();

const NOTICE_LABEL: Record<Exclude<NoticeKind, "hidden">, string> = {
  stopped: "Topic paused",
  unshared: "Topic unshared",
  deleted: "Topic deleted",
};

function noticeText(kind: Exclude<NoticeKind, "hidden">, topic: string) {
  switch (kind) {
    case "stopped":
      return `Its host paused “${topic}”, so new briefs stopped. You still follow it.`;
    case "unshared":
      return `“${topic}” is no longer shared, so its briefs stopped.`;
    case "deleted":
      return `Its host deleted “${topic}”, so its briefs stopped.`;
  }
}

function Feed({
  data,
  home,
  reload,
  signedOut,
}: {
  data: HostedData;
  home: Home;
  reload: () => Promise<void>;
  signedOut: (err: unknown) => boolean;
}) {
  const [filter, setFilter] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const picks = usePicks(data, signedOut);
  // Reading events for picks; only this signed-in hosted feed records them.
  React.useEffect(
    () => startUsage(data, home.interests),
    [data, home.interests],
  );
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage read on mount
    setDismissed(readDismissed());
  }, []);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      if (!signedOut(err))
        setError(
          err instanceof HostedError
            ? err.message
            : "Something went wrong. Try again.",
        );
    } finally {
      setBusy(null);
    }
  }

  const items: NoticeView[] = [];
  for (const n of home.notices) {
    const notice: FeedNotice = {
      id: n.id,
      kind: n.kind,
      topic: n.topic,
      at: n.createdAt,
    };
    const dismiss = () => void act(n.id, () => data.dismiss(n.id));
    if (n.kind === "hidden") {
      items.push({
        notice,
        label: "Topic hidden",
        tone: "bad",
        body: (
          <>
            <p>
              Scout hid “{n.topic}”, so no one else can find or follow it.
              {n.reason && <> Reason: {n.reason}</>}
            </p>
            <p className="mt-1 text-secondary [&_a]:underline [&_a]:underline-offset-2">
              Think this is a mistake? Write to <ContactEmail />.
            </p>
          </>
        ),
        onDismiss: dismiss,
      });
      continue;
    }
    items.push({
      notice,
      label: NOTICE_LABEL[n.kind],
      tone: "neutral",
      body: <>{noticeText(n.kind, n.topic)}</>,
      action: (
        <Button
          variant="secondary"
          size="sm"
          loading={busy === n.id}
          disabled={busy !== null}
          onClick={() =>
            void act(n.id, async () => {
              const id = await data.hostCopy(n.id);
              await scheduleNew(data, [id], false);
            })
          }
        >
          Host it yourself
        </Button>
      ),
      onDismiss: dismiss,
    });
  }
  const failedNotices = home.interests
    .filter((i) => i.failed && !i.run && !i.following)
    .map(
      (i): FeedNotice => ({
        id: `failed:${i.id}:${i.updatedAt ?? "none"}`,
        kind: "run_failed",
        topic: i.topic,
        at: null,
      }),
    );
  for (const notice of visibleNotices(failedNotices, dismissed)) {
    const interestId = notice.id.split(":")[1];
    items.push({
      notice,
      label: "Run failed",
      tone: "bad",
      body: (
        <>
          <span className="font-medium">{notice.topic}</span>: the last run
          failed. Run it again, or wait for the next one.
        </>
      ),
      action: (
        <Button
          variant="secondary"
          size="sm"
          loading={busy === notice.id}
          disabled={busy !== null}
          onClick={() => void act(notice.id, () => data.runNow(interestId))}
        >
          Run now
        </Button>
      ),
      onDismiss: () => setDismissed(dismissLocally(notice.id)),
    });
  }

  const brief = home.brief;
  const topics = home.interests.filter((i) =>
    brief?.articles.some((a) => key(a.interest) === key(i.topic)),
  );
  const live = filter && topics.some((t) => key(t.topic) === key(filter));
  const shown =
    brief && live
      ? {
          ...brief,
          articles: brief.articles.filter(
            (a) => key(a.interest) === key(filter),
          ),
        }
      : brief;

  return (
    <>
      <FeedNotices items={items} />
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      {shown ? (
        <div data-main>
          <BriefLayout
            brief={shown}
            name=""
            filter={
              topics.length > 1 ? (
                <TopicFilter
                  topics={topics}
                  activeFilter={live ? filter : null}
                  onFilterChange={setFilter}
                />
              ) : undefined
            }
          />
        </div>
      ) : (
        <section className="flex flex-col gap-2" data-main>
          <h1 className="font-serif text-title-1">Your brief</h1>
          <p className="text-body text-secondary" aria-live="polite">
            {home.interests.some((i) => i.run !== null)
              ? "Writing your first brief. It usually takes a few minutes, and this page updates when it's ready."
              : "Your first brief shows here after the next run. Run a topic from Topics to get it sooner."}
          </p>
        </section>
      )}
      <PickCards picks={picks} max={3} />
    </>
  );
}
