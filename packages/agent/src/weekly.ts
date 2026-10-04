import { BRIEF_HISTORY_CAP, loadState, newBriefId, saveState } from "./state.js";
import { canonicalUrl, parseBrief } from "./brief-document.js";
import type { Brief } from "./contract.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKLY_STORY_LIMIT = 10;
type WeeklyStory = {
  topic: string;
  block: string;
  url: string;
  publishedAt: string | null;
  sourceGeneratedAt: string;
  sourceRank: number;
};

// Every story with a source URL, keyed on its first citation (or its image).
function extractStories(brief: Brief): WeeklyStory[] {
  const stories: WeeklyStory[] = [];
  for (const entry of parseBrief(brief.summary_md ?? "").entries) {
    if (entry.kind !== "story") continue;
    const url = entry.links[0]?.url ?? entry.image;
    if (!url) continue;
    stories.push({
      topic: entry.topic ?? "Top stories",
      block: entry.raw,
      url,
      publishedAt: entry.date,
      sourceGeneratedAt: brief.generated_at,
      sourceRank: stories.length,
    });
  }
  return stories;
}

export function createWeeklyBriefFromHistory(
  history: Brief[],
  now = new Date(),
): Brief {
  const cutoff = now.getTime() - WEEK_MS;
  const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const eligible = history.filter((b) => {
    if (b.kind === "weekly") return false;
    if (b.status !== "ready" || !b.summary_md) return false;
    const t = Date.parse(b.generated_at);
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
  });

  const seen = new Set<string>();
  const stories = eligible
    .flatMap(extractStories)
    .filter((story) => {
      if (!story.publishedAt) return true;
      return story.publishedAt >= cutoffDate && story.publishedAt <= today;
    })
    .sort((a, b) => {
      const byRun =
        Date.parse(b.sourceGeneratedAt) - Date.parse(a.sourceGeneratedAt);
      return byRun || a.sourceRank - b.sourceRank;
    })
    .filter((story) => {
      const key = canonicalUrl(story.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, WEEKLY_STORY_LIMIT);

  const generatedAt = now.toISOString();
  const body =
    stories.length > 0
      ? stories
          .map((story) => {
            const topicLine = `  _From ${story.topic}_`;
            return `${story.block}\n${topicLine}`;
          })
          .join("\n\n")
      : "_No eligible daily stories from the last seven days yet._";

  return {
    id: newBriefId(),
    generated_at: generatedAt,
    status: "ready",
    kind: "weekly",
    summary_md: ["# Weekly brief", "", "## Top stories this week", body].join(
      "\n",
    ),
  };
}

export function buildWeeklyBrief(history: Brief[], now = new Date()): Brief {
  return createWeeklyBriefFromHistory(history, now);
}

export async function createAndPersistWeeklyBrief(
  stateFile: string,
  now = new Date(),
): Promise<Brief> {
  const state = await loadState(stateFile);
  const brief = createWeeklyBriefFromHistory(state.briefs ?? [], now);
  const prior = state.briefs ?? [];
  const briefs = [brief, ...prior.filter((b) => b.id !== brief.id)].slice(
    0,
    BRIEF_HISTORY_CAP,
  );
  await saveState({ ...state, last_brief: brief, briefs }, stateFile);
  return brief;
}
