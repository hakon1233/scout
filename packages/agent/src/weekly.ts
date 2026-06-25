import {
  BRIEF_HISTORY_CAP,
  loadState,
  newBriefId,
  saveState,
  type Brief,
} from "./state.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKLY_STORY_LIMIT = 10;
const STORY_BULLET_RE = /^\s*[-*]\s+/;
const STORY_DATE_RE = /^\s*[-*]\s+`(\d{4}-\d{2}-\d{2}|undated)`/;
const HEADING_RE = /^##\s+(.+?)\s*$/;
// Non-global: storyUrl only needs the first match, and a `/g` regex carries
// `lastIndex` state across calls — a footgun that previously required a manual
// `lastIndex = 0` reset before every `.exec`. Stateless is safer here.
const LINK_RE = /\[[^\]]+\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/;

type WeeklyStory = {
  topic: string;
  block: string;
  url: string;
  publishedAt: string | null;
  sourceGeneratedAt: string;
  sourceRank: number;
};

function storyUrl(block: string): string | null {
  const match = LINK_RE.exec(block);
  return match?.[1] ?? null;
}

function storyDate(block: string): string | null {
  const match = STORY_DATE_RE.exec(block);
  if (!match || match[1] === "undated") return null;
  return match[1];
}

function extractStories(brief: Brief): WeeklyStory[] {
  const markdown = brief.summary_md ?? "";
  const stories: WeeklyStory[] = [];
  let topic = "Top stories";
  let current: string[] | null = null;
  let rank = 0;

  const flush = () => {
    if (!current) return;
    const block = current.join("\n").trim();
    const url = storyUrl(block);
    if (url) {
      stories.push({
        topic,
        block,
        url,
        publishedAt: storyDate(block),
        sourceGeneratedAt: brief.generated_at,
        sourceRank: rank++,
      });
    }
    current = null;
  };

  for (const line of markdown.split("\n")) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      topic = heading[1].trim();
      continue;
    }
    if (STORY_BULLET_RE.test(line)) {
      flush();
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  flush();
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
      const key = story.url.toLowerCase();
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
