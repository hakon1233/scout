// Sharing: a topic's link (private or shared), what a link shows signed in
// or out, following from it, and the notices when a host stops sharing.

import type { TopicCoverage } from "@scout/core";
import type { HostedClient } from "./client";
import { briefFrom } from "./home";
import { type HostedData, HostedError, type Visibility } from "./types";

export function sharingData(
  c: HostedClient,
): Pick<
  HostedData,
  "setVisibility" | "shared" | "follow" | "hostCopy" | "dismiss"
> {
  const { rest } = c;
  return {
    async setVisibility(interestId, visibility) {
      if (visibility === "public")
        throw new HostedError(
          "failed",
          "Publishing goes through Scout's check. Share the link instead.",
        );
      return await rest<string | null>("rpc/set_sharing", {
        method: "POST",
        body: { p_interest: interestId, p_visibility: visibility },
      });
    },

    async shared(slug) {
      const row = await rest<SharedRow | null>(
        "rpc/interest_by_slug",
        { method: "POST", body: { p_slug: slug } },
        true,
      );
      if (!row) return null;
      const run = row.run;
      return {
        id: row.id,
        topic: row.topic,
        visibility: row.visibility,
        owned: row.owned,
        following: row.following,
        team: row.team ?? false,
        brief: run?.section_md
          ? briefFrom(
              [{ topic: row.topic, section: run.section_md }],
              run.coverage ? [run.coverage] : [],
              { id: run.id, at: run.finished_at ?? "" },
            )
          : null,
      };
    },

    async follow(slug) {
      return await rest<string>("rpc/follow", {
        method: "POST",
        body: { p_slug: slug },
      });
    },

    async hostCopy(noticeId) {
      return await rest<string>("rpc/host_copy", {
        method: "POST",
        body: { p_notification: noticeId },
      });
    },

    async dismiss(noticeId) {
      await rest(`notifications?id=eq.${encodeURIComponent(noticeId)}`, {
        method: "PATCH",
        body: { read_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
    },
  };
}

type SharedRow = {
  id: string;
  topic: string;
  visibility: Visibility;
  owned: boolean;
  following: boolean;
  // The topic card's Scout team flag.
  team?: boolean;
  run: {
    id: string;
    section_md: string | null;
    coverage: TopicCoverage | null;
    finished_at: string | null;
  } | null;
};
