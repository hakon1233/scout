"use client";

import * as React from "react";
import type { HostedData, PushState } from "@/lib/hosted";

/** Why a bell can't work on this device, or null when it can. */
export function pushBlockedText(device: PushState | null): string | null {
  switch (device) {
    case "denied":
      return "Notifications are blocked for Scout. Allow them in your browser or phone settings, then reload.";
    case "needs-install":
      return "Add Scout to your Home Screen to get notifications.";
    case "unsupported":
      return "This browser can't show notifications.";
    case "on":
    case "off":
    case null:
      return null;
  }
}

/**
 * Per-topic push for every PushBell on a screen: which topics are on, whether
 * push is on for this device at all, and an optimistic toggle that rolls back
 * with the API's message when it refuses. Turning a bell on while this device
 * is off turns the device on first (the browser asks within the same tap).
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
      // Called straight from the tap, nothing awaited before pushEnable:
      // Safari asks for permission only within the tap.
      const ready =
        on && device !== "on"
          ? data.pushEnable().then((state) => {
              setDevice(state);
              if (state !== "on")
                throw new Error(
                  pushBlockedText(state) ??
                    "Notifications stayed off for this device.",
                );
            })
          : Promise.resolve();
      ready
        .then(() => data.setTopicPush(interestId, on))
        .catch((e: unknown) => {
          flip(!on);
          setError(
            e instanceof Error ? e.message : "Couldn't change that. Try again.",
          );
        });
    },
    [data, device],
  );

  return {
    isOn: (interestId: string) => ids.has(interestId),
    set,
    /** This device's push state, null while loading. */
    device,
    /** Push is on for this device: a bell shows its topic's state. */
    deviceOn: device === "on",
    /** Why bells can't work here (blocked, needs install), or null. */
    blocked: pushBlockedText(device),
    /** The device switch changed (Settings), so the bells follow at once. */
    deviceChanged: setDevice,
    error,
  };
}
