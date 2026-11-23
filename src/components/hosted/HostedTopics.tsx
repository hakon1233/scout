"use client";

import Link from "next/link";
import * as React from "react";
import { AppSkeleton } from "@/components/AppSkeleton";
import { PushBell } from "@/components/PushBell";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui";
import { useTopicPush } from "@/hooks/useTopicPush";
import { formatDate } from "@/lib/format-date";
import {
  HostedError,
  type Cadence,
  type HostedData,
  type HostedHome as Home,
  type HostedInterest,
  type Visibility,
} from "@/lib/hosted";
import { dailyOffered, planFor, planUsage } from "@/lib/plans";
import { HostedChat } from "./HostedChat";
import { hostedMenu } from "./HostedHome";
import { PauseButton, usePauseTopic, type PauseTopic } from "./PauseButton";
import { useHostedHome } from "./useHostedHome";

const UNDO_MS = 15_000;

// The Topics page: Browse first, then the reader's own topics with their
// schedule and privacy, then the ones they follow. "New" opens the setup chat
// (also reached from the menu's "New topic" as ?new=1).
export function HostedTopics() {
  const {
    data,
    home,
    turns,
    loadError,
    reload,
    patch,
    signedOut,
    send,
    confirm,
    transcribe,
  } = useHostedHome({ chat: true });
  const [chatOpen, setChatOpen] = React.useState(false);
  const push = useTopicPush(data);

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1")
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL read on mount
      setChatOpen(true);
  }, []);

  return (
    <AppShell menu={home ? hostedMenu(home) : undefined}>
      <PageHeader
        title="Topics"
        back={{ href: "/app/", label: "Brief" }}
        action={
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={chatOpen}
            onClick={() => setChatOpen((o) => !o)}
          >
            {chatOpen ? "Close" : "+ New"}
          </Button>
        }
      />

      {chatOpen && data && home && (
        <div className="rounded-card border border-border-default bg-surface p-4">
          <HostedChat
            turns={turns.slice(-6)}
            send={send}
            confirm={confirm}
            transcribe={transcribe}
            allowance={home.allowance}
            label="Message Scout"
            autoFocus
          />
        </div>
      )}

      <Link
        href="/app/browse/"
        className="flex min-h-14 items-center gap-3 rounded-card border border-border-default bg-surface px-4 py-3 transition hover:bg-surface-muted/60"
      >
        <span className="flex-1">
          <span className="block text-body font-medium text-primary">
            Browse public topics
          </span>
          <span className="block text-body-sm text-muted">
            Follow what others share. Follows don&apos;t count toward your plan.
          </span>
        </span>
        <span aria-hidden="true" className="text-muted">
          ›
        </span>
      </Link>

      {!data || !home ? (
        loadError ? (
          <p className="text-body text-danger">{loadError}</p>
        ) : (
          <AppSkeleton />
        )
      ) : (
        <TopicLists
          data={data}
          home={home}
          reload={reload}
          patch={patch}
          onSignedOut={signedOut}
          push={push}
        />
      )}
    </AppShell>
  );
}

type Push = ReturnType<typeof useTopicPush>;

function TopicLists({
  data,
  home,
  reload,
  patch,
  onSignedOut,
  push,
}: {
  data: HostedData;
  home: Home;
  reload: () => Promise<void>;
  patch: (fn: (h: Home) => Home) => void;
  onSignedOut: (err: unknown) => boolean;
  push: Push;
}) {
  const pause = usePauseTopic({
    data,
    home,
    patch,
    reload,
    signedOut: onSignedOut,
  });
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [removed, setRemoved] = React.useState<HostedInterest | null>(null);

  React.useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  async function act(id: string, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [id]: true }));
    setNotes(({ [id]: _, ...rest }) => rest);
    try {
      await fn();
      await reload();
    } catch (err) {
      if (!onSignedOut(err))
        setNotes((n) => ({
          ...n,
          [id]:
            err instanceof HostedError
              ? err.message
              : "Something went wrong. Try again.",
        }));
    } finally {
      setBusy(({ [id]: _, ...rest }) => rest);
    }
  }

  const remove = (i: HostedInterest) =>
    act(i.id, async () => {
      await (i.following ? data.unfollow(i.id) : data.remove(i.id));
      setRemoved(i);
    });

  const own = home.interests.filter((i) => !i.following);
  const following = home.interests.filter((i) => i.following);
  const plan = planFor(home.allowance.plan);
  const usage = planUsage(plan, {
    daily: home.allowance.daily.used,
    weekly: home.allowance.weekly.used,
    public: own.filter((i) => i.visibility === "public").length,
  });

  const row = (i: HostedInterest) => (
    <TopicRow
      key={i.id}
      interest={i}
      busy={busy[i.id] ?? false}
      note={notes[i.id] ?? pause.note(i.id)}
      pause={pause}
      push={push}
      daily={dailyOffered(plan)}
      onCadence={(c) => void act(i.id, () => data.setCadence(i.id, c))}
      onRunNow={() => void act(i.id, () => data.runNow(i.id))}
      onRemove={() => void remove(i)}
    />
  );

  const undo = removed && (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="min-w-0 text-body-sm text-muted">
        {removed.following ? "Unfollowed" : "Deleted"} “{removed.topic}”.
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const back = removed;
          setRemoved(null);
          void act(back.id, () =>
            back.following
              ? Promise.reject(
                  new HostedError(
                    "failed",
                    "Find it in Browse or its link to follow it again.",
                  ),
                )
              : data.restore(back.id),
          );
        }}
      >
        Undo
      </Button>
    </li>
  );

  return (
    <div className="flex flex-col gap-8" data-main>
      <section className="flex flex-col gap-2" aria-labelledby="topics-yours">
        <h2 id="topics-yours" className="px-1 text-body-sm text-muted">
          Yours
        </h2>
        {own.length === 0 && !(removed && !removed.following) ? (
          <p className="px-1 text-body-sm text-secondary">
            No topics of your own yet. Press New to tell Scout what to follow.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-surface">
            {own.map(row)}
            {removed && !removed.following && undo}
          </ul>
        )}
        <p className="px-1 text-body-sm text-muted">
          {plan.name} plan: {usage}.{" "}
          {plan.id === "free" && (
            <Link
              href="/app/upgrade/"
              className="tap-target font-medium text-primary underline-offset-2 hover:underline"
            >
              Upgrade
            </Link>
          )}
        </p>
      </section>

      {(following.length > 0 || removed?.following) && (
        <section
          className="flex flex-col gap-2"
          aria-labelledby="topics-following"
        >
          <h2 id="topics-following" className="px-1 text-body-sm text-muted">
            Following
          </h2>
          <ul className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-surface">
            {following.map(row)}
            {removed?.following && undo}
          </ul>
        </section>
      )}
      {push.error && (
        <p role="alert" className="text-body-sm text-danger">
          {push.error}
        </p>
      )}
    </div>
  );
}

const CADENCES: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly, Mondays" },
  { value: "off", label: "Paused" },
];

/** On-screen names for a topic's privacy. */
export const PRIVACY: Record<Visibility, string> = {
  private: "Private",
  shared: "Link only",
  public: "Public",
};

const SELECT =
  "min-h-11 rounded-[12px] border border-border-strong bg-surface px-2 text-body-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

function TopicRow({
  interest: i,
  busy,
  note,
  pause,
  push,
  daily,
  onCadence,
  onRunNow,
  onRemove,
}: {
  interest: HostedInterest;
  busy: boolean;
  note: string | null;
  pause: PauseTopic;
  push: Push;
  /** False on Free: Daily shows as a Plus option the reader can't pick. */
  daily: boolean;
  onCadence: (c: Cadence) => void;
  onRunNow: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const status =
    i.run === "queued"
      ? "Waiting to start…"
      : i.run === "running"
        ? "Writing the brief…"
        : i.updatedAt
          ? formatDate(i.updatedAt)
          : "No brief yet";
  const meta = i.following
    ? [
        // The label comes from the team flag, never from the name.
        ...(i.team ? ["Scout team"] : i.ownerName ? [`By ${i.ownerName}`] : []),
        status,
      ]
    : [
        CADENCES.find((c) => c.value === i.cadence)?.label.split(",")[0] ??
          "Paused",
        PRIVACY[i.visibility],
        status,
      ];
  const failed = i.failed && !i.run;

  return (
    <li className="flex flex-col gap-3 py-2 pl-4 pr-2">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 py-1">
          <Link
            href={`/app/topics/?id=${encodeURIComponent(i.id)}`}
            className="tap-target break-words text-body font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {i.topic}
          </Link>
          <p
            className={`text-body-sm ${failed ? "text-danger" : "text-muted"}`}
          >
            {failed ? i.failed : meta.join(" · ")}
          </p>
        </div>
        {!i.following && <PauseButton interest={i} pause={pause} inRow />}
        <PushBell
          topic={i.topic}
          on={push.isOn(i.id)}
          onChange={(on) => push.set(i.id, on)}
          deviceOn={push.deviceOn}
          blocked={push.blocked}
        />
        <button
          type="button"
          aria-label={`Options for ${i.topic}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-secondary transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <span aria-hidden="true" className="text-title-3 leading-none">
            ⋯
          </span>
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 pb-2">
          {!i.following && (
            <>
              <label className="sr-only" htmlFor={`cadence-${i.id}`}>
                Schedule for {i.topic}
              </label>
              <select
                id={`cadence-${i.id}`}
                value={i.cadence}
                disabled={busy}
                onChange={(e) => onCadence(e.target.value as Cadence)}
                className={SELECT}
              >
                {CADENCES.map((c) =>
                  c.value === "daily" && !daily ? (
                    <option key={c.value} value={c.value} disabled>
                      Daily (Plus)
                    </option>
                  ) : (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ),
                )}
              </select>
              <Button
                variant="secondary"
                size="sm"
                className="min-w-28"
                loading={i.run !== null}
                disabled={busy}
                onClick={onRunNow}
              >
                {i.run ? "Running" : "Run now"}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
            {i.following ? "Unfollow" : "Delete"}
          </Button>
        </div>
      )}
      {note && (
        <p role="alert" className="pb-2 text-body-sm text-danger">
          {note}
        </p>
      )}
    </li>
  );
}
