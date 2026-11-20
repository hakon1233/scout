"use client";

import * as React from "react";
import type { NoticeView } from "@/components/FeedNotices";
import { Button } from "@/components/ui";
import { muteNoticeId } from "@/lib/feed-notices";
import {
  HostedError,
  type HostedData,
  type MuteSuggestions,
} from "@/lib/hosted";

// "Lots of pushes, mute some?": a feed notice when the reader got 10 or more
// pushes this week (my_mute_suggestions), naming up to 3 topics, least read
// first, each muted with one tap. Muting turns the topic's bell off, the same
// switch as in Settings; its news then comes in the Monday digest. Dismissed
// on this device for the rest of the week.

/** The notice, or null when there is nothing to offer or it was dismissed. */
export function useMuteNotice(
  data: HostedData,
  dismissed: ReadonlySet<string>,
  onDismiss: (id: string) => void,
  signedOut: (err: unknown) => boolean,
): NoticeView | null {
  const [offer, setOffer] = React.useState<MuteSuggestions | null>(null);
  const [muted, setMuted] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    data.muteSuggestions().then(
      (s) => live && setOffer(s),
      // An extra; without it the feed reads the same.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data]);

  if (!offer || offer.topics.length === 0) return null;
  const id = muteNoticeId(new Date());
  if (dismissed.has(id)) return null;

  async function toggle(topicId: string, mute: boolean) {
    setBusy(topicId);
    setError(null);
    try {
      await data.setTopicPush(topicId, !mute);
      setMuted((m) => {
        const next = new Set(m);
        if (mute) next.add(topicId);
        else next.delete(topicId);
        return next;
      });
    } catch (err) {
      if (!signedOut(err))
        setError(
          err instanceof HostedError
            ? err.message
            : "Couldn't change that. Try again.",
        );
    } finally {
      setBusy(null);
    }
  }

  return {
    notice: { id, kind: "mute_pushes", topic: null, at: null },
    label: "Lots of pushes",
    tone: "neutral",
    body: (
      <>
        <p>
          You got {offer.pushes} pushes this week. Mute a topic and its news
          comes in the Monday digest instead.
        </p>
        <ul className="mt-2 flex flex-col">
          {offer.topics.map((t) => {
            const isMuted = muted.has(t.id);
            return (
              <li
                key={t.id}
                className="flex min-h-11 items-center justify-between gap-3"
              >
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {isMuted && (
                    <span className="text-caption text-muted">Muted</span>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === t.id}
                    disabled={busy !== null}
                    aria-label={`${isMuted ? "Undo mute" : "Mute"} ${t.title}`}
                    onClick={() => void toggle(t.id, !isMuted)}
                  >
                    {isMuted ? "Undo" : "Mute"}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="mt-1 text-danger">
            {error}
          </p>
        )}
      </>
    ),
    onDismiss: () => onDismiss(id),
  };
}
