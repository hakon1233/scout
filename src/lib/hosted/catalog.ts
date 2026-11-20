// The public catalog: publishing through Scout's check, the owner's tags,
// browse and tag counts (signed in or out), reports, and the reader's picks.

import { PUBLISH_PATH, type PublishResponse } from "@scout/core";
import type { HostedClient } from "./client";
import type { HostedData, TopicCard } from "./types";

export function catalogData(
  c: HostedClient,
): Pick<
  HostedData,
  | "publish"
  | "setTags"
  | "browse"
  | "tagCounts"
  | "report"
  | "picks"
  | "dismissPick"
> {
  const { rest, worker } = c;
  return {
    async publish(interestId) {
      return (await worker(PUBLISH_PATH, {
        interest: interestId,
      })) as PublishResponse;
    },

    async setTags(interestId, tags) {
      return await rest<string[]>("rpc/set_topic_tags", {
        method: "POST",
        body: { p_interest: interestId, p_tags: tags },
      });
    },

    async browse(query = {}) {
      const rows = await rest<TopicCardRow[]>(
        "rpc/browse_topics",
        {
          method: "POST",
          body: {
            p_q: query.q?.trim() || null,
            p_tags: query.tags?.length ? query.tags : null,
            p_sort: query.sort ?? "popular",
            p_limit: Math.min(query.limit ?? 24, 50),
            p_offset: query.offset ?? 0,
          },
        },
        true,
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        tags: r.tags ?? [],
        ownerName: r.owner_name,
        team: r.team,
        followers: r.followers ?? 0,
        briefs: r.briefs ?? [],
      }));
    },

    async tagCounts() {
      return await rest<{ tag: string; topics: number }[]>(
        "rpc/tag_counts",
        { method: "POST", body: {} },
        true,
      );
    },

    async report(interestId, reason) {
      await rest("rpc/report_topic", {
        method: "POST",
        body: { p_interest: interestId, p_reason: reason.trim() },
      });
    },

    async picks() {
      const rows = await rest<
        (Omit<TopicCardRow, "briefs" | "followers"> & {
          reason: string | null;
        })[]
      >("rpc/my_picks", { method: "POST", body: {} });
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        tags: r.tags ?? [],
        ownerName: r.owner_name,
        team: r.team,
        reason: r.reason ?? "",
      }));
    },

    async dismissPick(interestId) {
      await rest("rpc/dismiss_pick", {
        method: "POST",
        body: { p_interest: interestId },
      });
    },
  };
}

export type TopicCardRow = {
  id: string;
  slug: string;
  title: string;
  tags: string[] | null;
  owner_name: string | null;
  team: boolean;
  followers?: number;
  briefs: TopicCard["briefs"] | null;
};
