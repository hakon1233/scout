"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useHostedData } from "@/hooks/useHostedData";
import type { ChatConfirm, ChatTurn } from "@scout/core";
import {
  HostedError,
  type Allowance,
  type HostedData,
  type HostedHome,
} from "@/lib/hosted";

const POLL_MS = 5_000;

/**
 * The signed-in reader's home data for the feed and the Topics page: loads it,
 * polls while a run is in flight, reloads on focus, sends a signed-out reader
 * to sign in, and runs the setup chat.
 */
export function useHostedHome({ chat = false }: { chat?: boolean } = {}) {
  const data = useHostedData();
  const router = useRouter();
  const [home, setHome] = React.useState<HostedHome | null>(null);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

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

  const failed = React.useCallback(
    (err: unknown) => {
      if (!signedOut(err))
        setLoadError(
          err instanceof HostedError
            ? err.message
            : "Couldn't load your briefs.",
        );
    },
    [signedOut],
  );

  const reload = React.useCallback(async () => {
    if (!data) return;
    try {
      setHome(await data.home());
      setLoadError(null);
    } catch (err) {
      failed(err);
    }
  }, [data, failed]);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    Promise.all([data.home(), chat ? data.transcript() : Promise.resolve([])])
      .then(([h, t]) => {
        if (!live) return;
        setHome(h);
        setTurns(t);
      })
      .catch((err: unknown) => live && failed(err));
    return () => {
      live = false;
    };
  }, [data, failed, chat]);

  // Poll while a run is queued or running, or a new scheduled topic waits
  // for its first brief (the server queues it on its next tick).
  const waiting =
    home?.interests.some(
      (i) =>
        i.run !== null ||
        (!i.following && i.cadence !== "off" && !i.updatedAt && !i.failed),
    ) ?? false;
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

  const send = React.useCallback(
    async (message: string) => {
      if (!data || !home) return;
      const turn = await data.chat(message);
      setTurns((t) => [...t, turn]);
      const creates = (turn.changes ?? []).filter((c) => c.op === "create");
      const asked = Object.fromEntries(
        creates.flatMap((c) => (c.cadence ? [[c.interestId, c.cadence]] : [])),
      );
      const created = creates.map((c) => c.interestId);
      if (created.length > 0) await scheduleNew(data, created, asked);
      await reload();
    },
    [data, home, reload],
  );

  const confirm = React.useCallback(
    async (action: ChatConfirm) => {
      if (!data) return;
      const turn = await data.confirm(action);
      setTurns((t) => [...t, turn]);
      await reload();
    },
    [data, reload],
  );

  // A recorded clip as text for the chat input (the Worker's /voice).
  const transcribe = React.useCallback(
    async (audio: Blob) => {
      if (!data) throw new HostedError("failed", "Type instead.");
      return data.transcribe(audio);
    },
    [data],
  );

  return {
    data,
    home,
    turns,
    loadError,
    reload,
    signedOut,
    send,
    confirm,
    transcribe,
  };
}

// A new topic takes the cadence the reader asked for in the chat (`asked`)
// when that slot is free, else stays paused: never the other cadence. One
// with none asked takes the first free slot (daily, then weekly) or stays
// paused. A scheduled one gets its first brief from the server's next tick
// (due_interests), so it never spends the day's Run now.
export async function scheduleNew(
  data: HostedData,
  ids: string[],
  asked: Partial<Record<string, "daily" | "weekly">> = {},
) {
  let home: HostedHome;
  try {
    home = await data.home();
  } catch {
    return;
  }
  const free = { ...home.allowance };
  for (const id of ids) {
    const want = asked[id];
    const slot = want
      ? free[want].used < free[want].limit
        ? want
        : null
      : freeSlot(free);
    if (!slot) continue;
    try {
      await data.setCadence(id, slot);
      free[slot] = { ...free[slot], used: free[slot].used + 1 };
    } catch {
      // The plan said no after all: it stays paused, and its row says so.
    }
  }
}

function freeSlot(a: Allowance): "daily" | "weekly" | null {
  if (a.daily.used < a.daily.limit) return "daily";
  if (a.weekly.used < a.weekly.limit) return "weekly";
  return null;
}
