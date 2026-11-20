// The reader's account: profile, time zone, usage events and deleting it all.

import type { HostedClient } from "./client";
import { type HostedData, HostedError, MAX_EVENT_BATCH } from "./types";

export function accountData(
  c: HostedClient,
): Pick<
  HostedData,
  | "profile"
  | "setProfile"
  | "timeZone"
  | "setTimeZone"
  | "sendEvents"
  | "deleteAccount"
> {
  const { session, rest, worker } = c;
  return {
    async profile() {
      const s = await session();
      const rows = await rest<ProfileRow[]>(
        `profiles?id=eq.${encodeURIComponent(s.userId)}&select=display_name,location,student,role,liked_tags`,
      );
      const r = rows[0];
      return {
        displayName: r?.display_name ?? null,
        location: r?.location ?? null,
        student: r?.student ?? null,
        role: r?.role ?? null,
        likedTags: r?.liked_tags ?? [],
      };
    },

    async setProfile(change) {
      const s = await session();
      const row: Record<string, unknown> = {};
      const text = (v: string | null) => (v?.trim() ? v.trim() : null);
      if ("displayName" in change)
        row.display_name = text(change.displayName ?? null);
      if ("location" in change) row.location = text(change.location ?? null);
      if ("role" in change) row.role = text(change.role ?? null);
      if ("student" in change) row.student = change.student ?? null;
      if ("likedTags" in change) row.liked_tags = change.likedTags ?? [];
      if (Object.keys(row).length === 0) return;
      try {
        await rest(`profiles?id=eq.${encodeURIComponent(s.userId)}`, {
          method: "PATCH",
          body: row,
          prefer: "return=minimal",
        });
      } catch (err) {
        if (err instanceof HostedError && err.kind === "failed")
          throw new HostedError(
            "failed",
            "Couldn't save that. Check the name isn't Scout's or an admin's, and try again.",
          );
        throw err;
      }
    },

    async timeZone() {
      const s = await session();
      const rows = await rest<{ timezone: string | null }[]>(
        `profiles?select=timezone&id=eq.${encodeURIComponent(s.userId)}`,
      );
      return rows[0]?.timezone ?? null;
    },

    async setTimeZone(timeZone) {
      await rest("rpc/set_timezone", {
        method: "POST",
        body: { p_tz: timeZone },
      });
    },

    async sendEvents(events) {
      for (let at = 0; at < events.length; at += MAX_EVENT_BATCH) {
        await rest("usage_events", {
          method: "POST",
          body: events.slice(at, at + MAX_EVENT_BATCH).map((e) => ({
            kind: e.kind,
            interest_id: e.interestId,
            run_id: e.runId ?? null,
            story_key: "storyKey" in e ? e.storyKey : null,
            seconds:
              e.kind === "story_seconds"
                ? Math.min(3600, Math.max(0, Math.round(e.seconds)))
                : null,
          })),
          prefer: "return=minimal",
          keepalive: true,
        });
      }
    },

    async deleteAccount() {
      await worker("/account/delete", {});
    },
  };
}

type ProfileRow = {
  display_name: string | null;
  location: string | null;
  student: boolean | null;
  role: string | null;
  liked_tags: string[] | null;
};
