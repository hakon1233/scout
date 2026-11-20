"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { ChatConfirm, ChatTurn } from "@scout/core";
import { AppSkeleton } from "@/components/AppSkeleton";
import { ScoutWordmark } from "@/components/AppNav";
import { BriefLayout } from "@/components/BriefLayout";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Banner, Button } from "@/components/ui";
import { hostedAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format-date";
import {
  allowanceLine,
  HostedError,
  hostedData,
  type Allowance,
  type Cadence,
  type HostedData,
  type HostedHome as Home,
  type HostedInterest,
  type Notice,
  shareUrl,
  type Visibility,
} from "@/lib/hosted";
import { HostedChat } from "./HostedChat";
import { PushSwitch } from "./PushSwitch";

const POLL_MS = 5_000;
const UNDO_MS = 15_000;

// The signed-in hosted app on one screen: the reader's interests with their
// schedules and sharing, the setup chat one click away, their latest brief, and
// a bell for interests whose host stopped sharing them. A reader with no
// interests lands straight in the chat.
export function HostedHome() {
  const data = hostedData();
  const router = useRouter();
  const [home, setHome] = React.useState<Home | null>(null);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);

  const signedOut = React.useCallback(
    (err: unknown) => {
      if (err instanceof HostedError && err.kind === "signed-out") {
        router.replace("/app/signin/");
        return true;
      }
      return false;
    },
    [router],
  );

  const reload = React.useCallback(async () => {
    if (!data) return;
    try {
      setHome(await data.home());
      setLoadError(null);
    } catch (err) {
      if (!signedOut(err))
        setLoadError(
          err instanceof HostedError
            ? err.message
            : "Couldn't load your briefs.",
        );
    }
  }, [data, signedOut]);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    Promise.all([data.home(), data.transcript()])
      .then(([h, t]) => {
        if (!live) return;
        setHome(h);
        setTurns(t);
      })
      .catch((err: unknown) => {
        if (live && !signedOut(err))
          setLoadError(
            err instanceof HostedError
              ? err.message
              : "Couldn't load your briefs.",
          );
      });
    return () => {
      live = false;
    };
  }, [data, signedOut]);

  // Poll while a run is queued or running, so its brief shows when ready.
  const waiting = home?.interests.some((i) => i.run !== null) ?? false;
  React.useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  // Back on the tab: a follow from a share link, or a host who stopped
  // sharing, shows without a manual reload.
  React.useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // `data` is null only while prerendering (no window); the client's first
  // render must match it, so both show the skeleton.
  if (!data || !home) {
    return (
      <Frame>
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
      </Frame>
    );
  }

  async function send(message: string) {
    const hadNone = home!.interests.length === 0;
    const turn = await data!.chat(message);
    setTurns((t) => [...t, turn]);
    const created = (turn.changes ?? [])
      .filter((c) => c.op === "create")
      .map((c) => c.interestId);
    if (created.length > 0) await scheduleNew(data!, created, hadNone);
    await reload();
  }

  async function confirm(action: ChatConfirm) {
    const turn = await data!.confirm(action);
    setTurns((t) => [...t, turn]);
    await reload();
  }

  const firstRun = home.interests.length === 0;
  return (
    <Frame
      notices={
        <Notices
          data={data}
          notices={home.notices}
          reload={reload}
          onSignedOut={signedOut}
        />
      }
    >
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
            label="Your interest"
            autoFocus
          />
        </section>
      ) : (
        <>
          <Interests
            data={data}
            home={home}
            reload={reload}
            onSignedOut={signedOut}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((o) => !o)}
            chat={
              <HostedChat
                turns={turns.slice(-6)}
                send={send}
                confirm={confirm}
                label="Message Scout"
                autoFocus
              />
            }
          />
          <LatestBrief home={home} />
        </>
      )}
    </Frame>
  );
}

// A new interest takes the first free slot (daily, then weekly) or stays
// paused. The reader's very first one also runs now, so a brief shows soon.
async function scheduleNew(data: HostedData, ids: string[], first: boolean) {
  let home: Home;
  try {
    home = await data.home();
  } catch {
    return;
  }
  const free = { ...home.allowance };
  for (const id of ids) {
    const slot = freeSlot(free);
    if (!slot) break;
    try {
      await data.setCadence(id, slot);
      free[slot] = { ...free[slot], used: free[slot].used + 1 };
    } catch {
      // The plan said no after all: it stays paused, and its row says so.
    }
  }
  if (first && ids[0]) await data.runNow(ids[0]).catch(() => undefined);
}

function freeSlot(a: Allowance): "daily" | "weekly" | null {
  if (a.daily.used < a.daily.limit) return "daily";
  if (a.weekly.used < a.weekly.limit) return "weekly";
  return null;
}

function Frame({
  notices,
  children,
}: {
  notices?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);
  return (
    <main className="min-h-screen bg-page px-4 py-8 text-primary sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <nav className="relative flex items-center justify-between gap-3">
          <ScoutWordmark />
          <div className="flex items-center gap-1 sm:gap-2">
            {notices}
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              loading={signingOut}
              onClick={async () => {
                setSigningOut(true);
                // This device stops getting the reader's pushes.
                await hostedData()
                  ?.pushDisable()
                  .catch(() => undefined);
                await hostedAuth()
                  ?.signOut()
                  .catch(() => undefined);
                router.replace("/app/signin/");
              }}
            >
              Sign out
            </Button>
          </div>
        </nav>
        {children}
      </div>
    </main>
  );
}

function Interests({
  data,
  home,
  reload,
  onSignedOut,
  chatOpen,
  onToggleChat,
  chat,
}: {
  data: HostedData;
  home: Home;
  reload: () => Promise<void>;
  onSignedOut: (err: unknown) => boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
  chat: React.ReactNode;
}) {
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

  return (
    <section className="flex flex-col gap-4" data-main>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-title-2">Your interests</h2>
        <Button variant="secondary" size="sm" onClick={onToggleChat}>
          {chatOpen ? "Close chat" : "Add or change"}
        </Button>
      </div>

      {chatOpen && (
        <div className="rounded-lg bg-surface-muted/50 p-4">{chat}</div>
      )}

      <ul className="flex flex-col divide-y divide-border-default border-y border-border-default">
        {home.interests.map((i) => (
          <InterestRow
            key={i.id}
            interest={i}
            busy={busy[i.id] ?? false}
            note={notes[i.id] ?? null}
            canPublish={home.isAdmin}
            onCadence={(c) => act(i.id, () => data.setCadence(i.id, c))}
            onVisibility={(v) =>
              act(i.id, async () => {
                await data.setVisibility(i.id, v);
              })
            }
            onRunNow={() => act(i.id, () => data.runNow(i.id))}
            onRemove={() => remove(i)}
          />
        ))}
        {removed && (
          <li className="flex flex-wrap items-center justify-between gap-3 py-3">
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
                          "Ask Scout in the chat to follow it again.",
                        ),
                      )
                    : data.restore(back.id),
                );
              }}
            >
              Undo
            </Button>
          </li>
        )}
      </ul>
      <p className="text-body-sm text-muted">{allowanceLine(home.allowance)}</p>
      <PushSwitch data={data} />
    </section>
  );
}

const CADENCES: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly, Mondays" },
  { value: "off", label: "Paused" },
];

const SHARING: { value: Visibility; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "shared", label: "Shared by link" },
  { value: "public", label: "Public" },
];

function InterestRow({
  interest: i,
  busy,
  note,
  canPublish,
  onCadence,
  onVisibility,
  onRunNow,
  onRemove,
}: {
  interest: HostedInterest;
  busy: boolean;
  note: string | null;
  // Only an admin may make an interest public (the catalog).
  canPublish: boolean;
  onCadence: (c: Cadence) => void;
  onVisibility: (v: Visibility) => void;
  onRunNow: () => void;
  onRemove: () => void;
}) {
  const meta =
    i.run === "queued"
      ? "Waiting to start…"
      : i.run === "running"
        ? "Writing the brief…"
        : i.updatedAt
          ? `Updated ${formatDate(i.updatedAt)}`
          : "No brief yet";
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="break-words text-body font-medium text-primary">
            {i.topic}
          </p>
          <p
            className={`text-body-sm ${i.failed && !i.run ? "text-danger" : "text-muted"}`}
          >
            {i.failed && !i.run ? i.failed : meta}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {i.following ? (
            <span className="px-1 text-body-sm text-muted">Following</span>
          ) : (
            <>
              <label className="sr-only" htmlFor={`cadence-${i.id}`}>
                Schedule for {i.topic}
              </label>
              <select
                id={`cadence-${i.id}`}
                value={i.cadence}
                disabled={busy}
                onChange={(e) => onCadence(e.target.value as Cadence)}
                className="min-h-9 rounded-md border border-border-strong bg-surface px-2 text-body-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
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
      </div>
      {!i.following && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`sharing-${i.id}`}>
            Sharing for {i.topic}
          </label>
          <select
            id={`sharing-${i.id}`}
            value={i.visibility}
            disabled={busy}
            onChange={(e) => onVisibility(e.target.value as Visibility)}
            className="min-h-9 rounded-md border border-border-default bg-transparent px-2 text-body-sm text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {SHARING.filter(
              (o) =>
                o.value !== "public" || canPublish || i.visibility === "public",
            ).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {i.shareSlug && <CopyLink slug={i.shareSlug} />}
        </div>
      )}
      {note && (
        <p role="alert" className="text-body-sm text-danger">
          {note}
        </p>
      )}
    </li>
  );
}

function CopyLink({ slug }: { slug: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="min-w-24"
      onClick={() =>
        navigator.clipboard
          .writeText(shareUrl(slug))
          .then(() => setCopied(true))
          .catch(() => window.prompt("Copy this link", shareUrl(slug)))
      }
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </Button>
  );
}

// The bell: interests the reader followed whose host stopped sharing them.
// Each offers "Host it yourself" (a copy of its own, within the plan) or
// Dismiss. Hidden when there is nothing to say.
function Notices({
  data,
  notices,
  reload,
  onSignedOut,
}: {
  data: HostedData;
  notices: Notice[];
  reload: () => Promise<void>;
  onSignedOut: (err: unknown) => boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ id: string; text: string } | null>(
    null,
  );
  if (notices.length === 0) return null;

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      if (!onSignedOut(err))
        setError({
          id,
          text:
            err instanceof HostedError
              ? err.message
              : "Something went wrong. Try again.",
        });
    } finally {
      setBusy(null);
    }
  }

  // The panel hangs from the whole nav (not the bell), so it stays on screen
  // at phone width. Escape closes it.
  return (
    <div onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="notices-list"
        aria-label={`${notices.length} ${notices.length === 1 ? "notice" : "notices"}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-9 items-center gap-2 rounded-pill px-3 text-body-sm text-primary transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span className="tabular-nums">{notices.length}</span>
      </button>
      {open && (
        <ul
          id="notices-list"
          className="absolute right-0 top-full z-10 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col divide-y divide-border-default rounded-lg border border-border-default bg-surface shadow-lg"
        >
          {notices.map((n) => (
            <li key={n.id} className="flex flex-col gap-2 p-4">
              <p className="break-words text-body-sm text-primary">
                “{n.topic}” is no longer shared, so its briefs stopped.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === n.id}
                  disabled={busy !== null}
                  onClick={() =>
                    act(n.id, async () => {
                      const id = await data.hostCopy(n.id);
                      await scheduleNew(data, [id], false);
                    })
                  }
                >
                  Host it yourself
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => act(n.id, () => data.dismiss(n.id))}
                >
                  Dismiss
                </Button>
              </div>
              {error?.id === n.id && (
                <p role="alert" className="text-body-sm text-danger">
                  {error.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LatestBrief({ home }: { home: Home }) {
  if (home.brief) return <BriefLayout brief={home.brief} name="" />;
  const writing = home.interests.some((i) => i.run !== null);
  return (
    <section className="flex flex-col gap-2 border-t border-border-default pt-8">
      <h2 className="font-serif text-title-2">Your brief</h2>
      <p className="text-body text-secondary" aria-live="polite">
        {writing
          ? "Writing your first brief. It usually takes a few minutes, and this page updates when it's ready."
          : "Your first brief shows here after the next run. Press Run now to get it sooner."}
      </p>
    </section>
  );
}
