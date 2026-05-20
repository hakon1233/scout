import { synthesizeBrief } from "./anthropic";
import { dedupeArticles, searchInterest } from "./exa";
import type { Article, Brief, Settings } from "./types";

const MAX_INTERESTS = 6;
const RESULTS_PER_INTEREST = 4;
const MAX_ARTICLES_TO_SYNTHESIZE = 18;

export type AgentProgress = {
  stage: "searching" | "synthesizing" | "done" | "error";
  message: string;
  articles?: Article[];
};

export async function runAgent(
  settings: Settings,
  onProgress: (p: AgentProgress) => void,
): Promise<Brief> {
  const interests = settings.interests
    .slice(0, MAX_INTERESTS)
    .map((i) => i.topic.trim())
    .filter(Boolean);

  if (interests.length === 0) {
    throw new Error("Add at least one interest before generating a brief.");
  }

  onProgress({
    stage: "searching",
    message: `Searching the web for ${interests.length} topic${interests.length === 1 ? "" : "s"}…`,
  });

  const searches = await Promise.allSettled(
    interests.map((topic) =>
      searchInterest(topic, settings.exaKey, {
        numResults: RESULTS_PER_INTEREST,
      }),
    ),
  );

  const articles: Article[] = [];
  const failedTopics: string[] = [];
  searches.forEach((s, i) => {
    if (s.status === "fulfilled") articles.push(...s.value);
    else failedTopics.push(interests[i]);
  });

  if (articles.length === 0) {
    throw new Error(
      failedTopics.length
        ? `Exa search failed for all topics (e.g. "${failedTopics[0]}"). Check your Exa key.`
        : "No articles found for your topics. Try broader or different interests.",
    );
  }

  const unique = dedupeArticles(articles).slice(0, MAX_ARTICLES_TO_SYNTHESIZE);

  onProgress({
    stage: "synthesizing",
    message: `Found ${unique.length} unique articles. Synthesizing your brief…`,
    articles: unique,
  });

  const markdown = await synthesizeBrief({
    apiKey: settings.anthropicKey,
    name: settings.name,
    interests,
    articles: unique,
  });

  const brief: Brief = {
    id: cryptoRandomId(),
    generatedAt: new Date().toISOString(),
    interests,
    articles: unique,
    markdown,
  };

  onProgress({ stage: "done", message: "Brief ready.", articles: unique });
  return brief;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
