import { synthesizeBrief } from "./anthropic";
import { dedupeArticles, searchInterest } from "./exa";
import type { Article, Brief, Settings } from "./types";

const MAX_INTERESTS = 6;
const RESULTS_PER_INTEREST = 4;
const MAX_ARTICLES_TO_SYNTHESIZE = 18;

export type InterestState = "pending" | "searching" | "done" | "failed";

export type PerInterestProgress = {
  topic: string;
  state: InterestState;
  resultCount?: number;
};

export type AgentProgress = {
  stage: "searching" | "synthesizing" | "done" | "error";
  message: string;
  articles?: Article[];
  perInterest: PerInterestProgress[];
};

export type RunAgentOptions = {
  signal?: AbortSignal;
};

export async function runAgent(
  settings: Settings,
  onProgress: (p: AgentProgress) => void,
  options: RunAgentOptions = {},
): Promise<Brief> {
  const { signal } = options;

  const interests = settings.interests
    .slice(0, MAX_INTERESTS)
    .map((i) => i.topic.trim())
    .filter(Boolean);

  if (interests.length === 0) {
    throw new Error("Add at least one interest before generating a brief.");
  }

  // All Exa fetches kick off in parallel via Promise.allSettled below, so the
  // initial per-interest state is `searching` for every topic.
  const perInterest: PerInterestProgress[] = interests.map((topic) => ({
    topic,
    state: "searching",
  }));

  const snapshot = (): PerInterestProgress[] =>
    perInterest.map((p) => ({ ...p }));

  onProgress({
    stage: "searching",
    message: `Searching the web for ${interests.length} topic${
      interests.length === 1 ? "" : "s"
    }…`,
    perInterest: snapshot(),
  });

  const searches = await Promise.allSettled(
    interests.map(async (topic, i) => {
      try {
        const results = await searchInterest(topic, settings.exaKey, {
          numResults: RESULTS_PER_INTEREST,
          signal,
        });
        perInterest[i] = {
          topic,
          state: "done",
          resultCount: results.length,
        };
        onProgress({
          stage: "searching",
          message: `Searched “${topic}” · ${results.length} result${
            results.length === 1 ? "" : "s"
          }`,
          perInterest: snapshot(),
        });
        return results;
      } catch (err) {
        if (signal?.aborted) throw err;
        perInterest[i] = { topic, state: "failed" };
        onProgress({
          stage: "searching",
          message: `Search failed for “${topic}”`,
          perInterest: snapshot(),
        });
        throw err;
      }
    }),
  );

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

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
    perInterest: snapshot(),
  });

  const markdown = await synthesizeBrief({
    apiKey: settings.anthropicKey,
    name: settings.name,
    interests,
    articles: unique,
    signal,
  });

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Synthesis succeeded — anything still in `searching` (none expected) and
  // all `done`/`failed` rows stay as-is; the per-interest panel just reflects
  // final search outcomes alongside the finished brief.
  const brief: Brief = {
    id: cryptoRandomId(),
    generatedAt: new Date().toISOString(),
    interests,
    articles: unique,
    markdown,
  };

  onProgress({
    stage: "done",
    message: "Brief ready.",
    articles: unique,
    perInterest: snapshot(),
  });
  return brief;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
