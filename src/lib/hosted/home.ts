// The feed: the reader's own and followed interests with their latest brief,
// the plan's allowance and unread notices, and the edits to one interest
// (cadence, brief settings, delete and undo, unfollow, run now).

import {
  assembleBrief,
  BRIEF_SETTINGS_COLUMNS,
  type BriefSettingsRow,
  briefSettingsFromRow,
  briefSettingsToRow,
  parseBriefSettings,
  type TopicCoverage,
} from "@scout/core";
import { parseArticlesFromMarkdown } from "../companion";
import type { Brief } from "../types";
import type { TopicCardRow } from "./catalog";
import type { HostedClient } from "./client";
import {
  type Cadence,
  type HostedData,
  HostedError,
  type HostedHome,
  type HostedInterest,
  type NoticeKind,
  type Visibility,
} from "./types";

const RUN_HISTORY = 200;

export function homeData(
  c: HostedClient,
): Pick<
  HostedData,
  | "home"
  | "createTopic"
  | "setCadence"
  | "setBriefSettings"
  | "remove"
  | "restore"
  | "unfollow"
  | "runNow"
> {
  const { session, rest, worker, patchInterest } = c;
  // Followed topics' owners, from each one's topic card (profiles are
  // private, so the card is the only place a name shows). A card that fails
  // to load leaves the owner unnamed.
  async function ownersOf(
    followed: InterestRow[],
  ): Promise<Map<string, { ownerName: string | null; team: boolean }>> {
    const cards = await Promise.all(
      followed
        .filter((r) => r.share_slug)
        .map((r) =>
          rest<TopicCardRow | null>("rpc/interest_by_slug", {
            method: "POST",
            body: { p_slug: r.share_slug },
          }).catch(() => null),
        ),
    );
    return new Map(
      cards
        .filter((c): c is TopicCardRow => c !== null)
        .map((c) => [
          c.id,
          { ownerName: c.owner_name ?? null, team: c.team === true },
        ]),
    );
  }
  return {
    async home() {
      const s = await session();
      const user = encodeURIComponent(s.userId);
      const [own, follows, allowance, profile, notices] = await Promise.all([
        rest<InterestRow[]>(
          `interests?select=${INTEREST_COLUMNS}&owner_id=eq.${user}&deleted_at=is.null&order=created_at.asc`,
        ),
        rest<{ interests: InterestRow | null }[]>(
          `follows?select=interests(${INTEREST_COLUMNS})&user_id=eq.${user}&order=created_at.asc`,
        ),
        rest<AllowanceRow>("rpc/allowance", {
          method: "POST",
          body: { p_user: s.userId },
        }),
        rest<{ is_admin: boolean; timezone_set: boolean }[]>(
          `profiles?select=is_admin,timezone_set&id=eq.${user}`,
        ),
        rest<NoticeRow[]>(
          `notifications?select=id,kind,payload,created_at&user_id=eq.${user}&kind=in.(hidden,stopped,unshared,deleted)&read_at=is.null&order=created_at.desc`,
        ),
      ]);
      // First sign-in: the browser's time zone, once. Later only Settings.
      if (profile[0] && !profile[0].timezone_set) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz)
          await rest("rpc/set_timezone", {
            method: "POST",
            body: { p_tz: tz, p_first_time: true },
          }).catch(() => null);
      }
      const rows: (InterestRow & { following: boolean })[] = [
        ...own.map((i) => ({ ...i, following: false })),
        ...follows
          .map((f) => f.interests)
          .filter((i): i is InterestRow => i !== null)
          .map((i) => ({ ...i, cadence: "off" as const, following: true })),
      ];
      const runs =
        rows.length === 0
          ? []
          : await rest<RunRow[]>(
              `runs?select=id,interest_id,status,section_md,coverage,error_msg,created_at,finished_at&interest_id=in.(${rows
                .map((r) => encodeURIComponent(r.id))
                .join(",")})&order=created_at.desc&limit=${RUN_HISTORY}`,
            );
      const owners = await ownersOf(rows.filter((r) => r.following));
      const assembled = assembleHome(rows, runs, allowance);
      return {
        ...assembled,
        interests: assembled.interests.map((i) => ({
          ...i,
          ...owners.get(i.id),
        })),
        isAdmin: profile[0]?.is_admin === true,
        notices: notices.map((n) => ({
          id: n.id,
          kind: n.kind,
          topic: n.payload?.topic ?? "A topic",
          reason: n.payload?.reason ?? null,
          createdAt: n.created_at,
        })),
      };
    },

    async createTopic(topic, doc) {
      const rows = await rest<{ id: string }[]>("interests?select=id", {
        method: "POST",
        body: { topic, doc },
        prefer: "return=representation",
      });
      const id = rows[0]?.id;
      if (!id) throw new HostedError("failed", "Couldn't add that topic.");
      return id;
    },

    async setCadence(interestId, cadence) {
      await patchInterest(interestId, { cadence });
    },

    async setBriefSettings(interestId, change) {
      const parsed = parseBriefSettings(change);
      if (!parsed.ok) throw new HostedError("failed", parsed.error);
      await patchInterest(interestId, briefSettingsToRow(change));
    },

    async remove(interestId) {
      await patchInterest(interestId, { deleted_at: new Date().toISOString() });
    },

    async restore(interestId) {
      await patchInterest(interestId, { deleted_at: null });
    },

    async unfollow(interestId) {
      const s = await session();
      await rest(
        `follows?user_id=eq.${encodeURIComponent(s.userId)}&interest_id=eq.${encodeURIComponent(interestId)}`,
        { method: "DELETE", prefer: "return=minimal" },
      );
    },

    async runNow(interestId) {
      await worker("/runs", { interestId });
    },
  };
}

const INTEREST_COLUMNS = `id,topic,cadence,visibility,share_slug,tags,mode,${BRIEF_SETTINGS_COLUMNS}`;

type InterestRow = Partial<BriefSettingsRow> & {
  id: string;
  topic: string;
  cadence: Cadence;
  visibility: Visibility;
  share_slug: string | null;
  tags?: string[] | null;
  mode?: "news" | "make";
};

type NoticeRow = {
  id: string;
  kind: NoticeKind;
  payload: { topic?: string; reason?: string | null } | null;
  created_at: string;
};

type RunRow = {
  id: string;
  interest_id: string;
  status: "queued" | "running" | "ready" | "failed";
  section_md: string | null;
  coverage: TopicCoverage | null;
  error_msg: string | null;
  created_at: string;
  finished_at: string | null;
};

type AllowanceRow = {
  plan: string;
  used: {
    daily_interests: number;
    weekly_interests: number;
    on_demand_runs_today: number;
  };
  limits: {
    daily_interests: number;
    weekly_interests: number;
    on_demand_runs_per_day: number;
  };
};

// Runs come newest first. Per interest: the run in flight, the newest ready
// section, and a failure only when it is newer than that section.
function assembleHome(
  rows: (InterestRow & { following: boolean })[],
  runs: RunRow[],
  a: AllowanceRow,
): Omit<HostedHome, "isAdmin" | "notices"> {
  const sections: { topic: string; section: string }[] = [];
  const coverage: TopicCoverage[] = [];
  let newest: RunRow | null = null;

  const interests = rows.map((row): HostedInterest => {
    const mine = runs.filter((r) => r.interest_id === row.id);
    const active = mine.find(
      (r) => r.status === "queued" || r.status === "running",
    );
    const ready = mine.find((r) => r.status === "ready" && r.section_md);
    const lastDone = mine.find(
      (r) => r.status === "ready" || r.status === "failed",
    );
    if (ready?.section_md) {
      sections.push({ topic: row.topic, section: ready.section_md });
      if (ready.coverage) coverage.push(ready.coverage);
      if (!newest || doneAt(ready) > doneAt(newest)) newest = ready;
    }
    return {
      id: row.id,
      topic: row.topic,
      cadence: row.cadence,
      settings: briefSettingsFromRow(row),
      following: row.following,
      visibility: row.visibility,
      shareSlug: row.share_slug,
      tags: row.tags ?? [],
      run: active ? (active.status as "queued" | "running") : null,
      updatedAt: ready ? doneAt(ready) : null,
      failed:
        lastDone?.status === "failed"
          ? "The last run failed. Run it again, or wait for the next one."
          : null,
      ownerName: null,
      team: false,
      ...(row.mode === "make" ? { make: true } : {}),
    };
  });

  const latest = newest as RunRow | null;
  return {
    interests,
    brief: latest
      ? briefFrom(sections, coverage, { id: latest.id, at: doneAt(latest) })
      : null,
    allowance: {
      plan: a.plan,
      daily: { used: a.used.daily_interests, limit: a.limits.daily_interests },
      weekly: {
        used: a.used.weekly_interests,
        limit: a.limits.weekly_interests,
      },
      runsToday: {
        used: a.used.on_demand_runs_today,
        limit: a.limits.on_demand_runs_per_day,
      },
    },
  };
}

// Brief sections as one Brief, named after the newest run in it.
export function briefFrom(
  sections: { topic: string; section: string }[],
  coverage: TopicCoverage[],
  newest: { id: string; at: string },
): Brief {
  const markdown = assembleBrief(sections);
  const id = `hosted-${newest.id}`;
  const parsed = parseArticlesFromMarkdown(markdown, id);
  return {
    id,
    generatedAt: newest.at,
    interests: parsed.interests,
    articles: parsed.articles,
    markdown,
    topics: coverage,
  };
}

function doneAt(r: RunRow): string {
  return r.finished_at ?? r.created_at;
}
