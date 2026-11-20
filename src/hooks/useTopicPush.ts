"use client";

import * as React from "react";
import type { HostedData, PushState } from "@/lib/hosted";

/**
 * Per-topic push for every PushBell on a screen: which topics are on, whether
 * push is on for this device at all, and an optimistic toggle that rolls back
 * with the API's message when it refuses.
 */
export function useTopicPush(data: HostedData | null) {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(new Set());
  const [device, setDevice] = React.useState<PushState | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    data.pushStatus().then(
      (s) => live && setDevice(s),
      () => live && setDevice("unsupported"),
    );
    data.topicPush().then(
      (list) => live && setIds(new Set(list)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [data]);

  const set = React.useCallback(
    (interestId: string, on: boolean) => {
      if (!data) return;
      const flip = (want: boolean) =>
        setIds((prev) => {
          const next = new Set(prev);
          if (want) next.add(interestId);
          else next.delete(interestId);
          return next;
        });
      setError(null);
      flip(on);
      data.setTopicPush(interestId, on).catch((e: unknown) => {
        flip(!on);
        setError(
          e instanceof Error ? e.message : "Couldn't change that. Try again.",
        );
      });
    },
    [data],
  );

  return {
    isOn: (interestId: string) => ids.has(interestId),
    set,
    /** Push is on for this device; bells are greyed out otherwise. */
    deviceOn: device === "on",
    /** The device switch changed (Settings), so the bells follow at once. */
    deviceChanged: setDevice,
    error,
  };
}
