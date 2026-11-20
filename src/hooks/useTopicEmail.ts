"use client";

import * as React from "react";
import type { HostedData } from "@/lib/hosted";

/**
 * Per-topic "Email me new briefs" for every EmailToggle on a screen: which
 * topics are on, whether email is switched on for Scout at all (`enabled`;
 * while it is off the toggles stay hidden), and an optimistic toggle that
 * rolls back with the API's message when it refuses.
 */
export function useTopicEmail(data: HostedData | null) {
  const [ids, setIds] = React.useState<ReadonlySet<string> | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    let live = true;
    data.topicEmail().then(
      (list) => live && setIds(list ? new Set(list) : null),
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
      data.setTopicEmail(interestId, on).catch((e: unknown) => {
        flip(!on);
        setError(
          e instanceof Error ? e.message : "Couldn't change that. Try again.",
        );
      });
    },
    [data],
  );

  return {
    enabled: ids !== null,
    isOn: (interestId: string) => ids?.has(interestId) ?? false,
    set,
    error,
  };
}
