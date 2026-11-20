// Likes and saves in the database (story_marks), and their sync for the
// likes and saves stores in likes.ts.

import type { LikedStory, LikesSync } from "../likes";
import type { HostedClient } from "./client";
import type { HostedData, MarkKind } from "./types";

export function marksData(
  c: HostedClient,
): Pick<HostedData, "marks" | "mark" | "unmark"> {
  const { rest } = c;
  return {
    async marks(kind) {
      const rows = await rest<MarkRow[]>(
        `story_marks?kind=eq.${kind}&select=story_key,interest_id,story,created_at&order=created_at.desc`,
      );
      return rows.map((r) => ({
        storyKey: r.story_key,
        interestId: r.interest_id,
        story: r.story,
        createdAt: r.created_at,
      }));
    },

    async mark(kind, mark) {
      await rest("story_marks?on_conflict=user_id,kind,story_key", {
        method: "POST",
        body: {
          kind,
          story_key: mark.storyKey,
          interest_id: mark.interestId,
          story: mark.story,
        },
        prefer: "return=minimal,resolution=ignore-duplicates",
      });
    },

    async unmark(kind, storyKey) {
      await rest(
        `story_marks?kind=eq.${kind}&story_key=eq.${encodeURIComponent(storyKey)}`,
        { method: "DELETE", prefer: "return=minimal" },
      );
    },
  };
}

type MarkRow = {
  story_key: string;
  interest_id: string | null;
  story: Record<string, unknown> | null;
  created_at: string;
};

/** The signed-in reader's likes in the database, for likes.ts. */
export function likesSync(data: HostedData): LikesSync {
  return marksSync(data, "like");
}

/** The signed-in reader's likes or saves in the database, for the story
 *  marks stores. The story snapshot is trimmed to fit story_marks' 4 KB. */
export function marksSync(data: HostedData, kind: MarkKind): LikesSync {
  return {
    async list() {
      const marks = await data.marks(kind);
      return marks.flatMap((m) =>
        m.story ? [{ ...m.story, key: m.storyKey } as LikedStory] : [],
      );
    },
    async add(story) {
      const snapshot = {
        ...story,
        headline: story.headline.slice(0, 300),
        blurb: story.blurb?.slice(0, 600),
        url: story.url.slice(0, 1000),
        imageUrl:
          story.imageUrl && story.imageUrl.length <= 600
            ? story.imageUrl
            : undefined,
      };
      await data.mark(kind, {
        storyKey: story.key,
        interestId: null,
        story: snapshot,
      });
    },
    async remove(key) {
      await data.unmark(kind, key);
    },
  };
}
