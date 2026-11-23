"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import {
  HostedError,
  type HostedData,
  type HostedHome,
  type HostedInterest,
} from "@/lib/hosted";
import { resumeSlot, withCadence } from "./useHostedHome";

/**
 * Pause and Resume for the reader's own topics, shared by Settings, the
 * Topics list and a topic's page. Pausing sets its cadence off and frees its
 * slot; Resume takes one back (resumeSlot) or says why it can't. The topic
 * shows its new state at once (withCadence); the reload that follows the
 * write puts the server's back, so a refusal rolls it back with a message.
 */
export function usePauseTopic({
  data,
  home,
  patch,
  reload,
  signedOut,
}: {
  data: HostedData;
  home: HostedHome;
  patch: (fn: (h: HostedHome) => HostedHome) => void;
  reload: () => Promise<void>;
  signedOut?: (err: unknown) => boolean;
}) {
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  // One write per topic at a time; a second press waits for nothing.
  const pending = React.useRef(new Set<string>());

  async function toggle(i: HostedInterest) {
    if (pending.current.has(i.id)) return;
    setNotes(({ [i.id]: _, ...rest }) => rest);
    let cadence: "daily" | "weekly" | "off" = "off";
    if (i.cadence === "off") {
      const slot = resumeSlot(home.allowance, i.lastCadence);
      if ("message" in slot) {
        setNotes((n) => ({ ...n, [i.id]: slot.message }));
        return;
      }
      cadence = slot.cadence;
    }
    pending.current.add(i.id);
    patch((h) => withCadence(h, i.id, cadence));
    try {
      await data.setCadence(i.id, cadence);
    } catch (err) {
      if (!signedOut?.(err))
        setNotes((n) => ({
          ...n,
          [i.id]:
            err instanceof HostedError
              ? err.message
              : "Couldn't save. Try again.",
        }));
    } finally {
      pending.current.delete(i.id);
    }
    await reload();
  }

  return {
    toggle,
    note: (id: string): string | null => notes[id] ?? null,
  };
}

export type PauseTopic = ReturnType<typeof usePauseTopic>;

// The same width for both labels, so nothing beside it moves.
export function PauseButton({
  interest: i,
  pause,
  inRow = false,
}: {
  interest: HostedInterest;
  pause: PauseTopic;
  /** In a list row beside icon buttons: quiet (ghost) and narrower. */
  inRow?: boolean;
}) {
  const verb = i.cadence === "off" ? "Resume" : "Pause";
  return (
    <Button
      variant={inRow ? "ghost" : "secondary"}
      size="sm"
      className={`shrink-0 ${inRow ? "min-w-20" : "min-w-24"}`}
      aria-label={`${verb} ${i.topic}`}
      onClick={() => void pause.toggle(i)}
    >
      {verb}
    </Button>
  );
}
