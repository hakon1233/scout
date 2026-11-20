// One research session's answer, turned into the section a run stores. Shared
// by the hosted API path (@scout/research) and the Scout team runner (the
// companion's `claude` CLI), so a team run reads exactly like any other.

import {
  computeCoverage,
  enforceBriefFreshness,
  extractTopicSection,
  normalizeTopic,
} from "./coverage.ts";
import type { TopicCoverage } from "./contract.ts";
import {
  stripBriefPreamble,
  type ResearchInterest,
} from "./research-prompt.ts";

// A story line Claude wrote without its `- ` bullet (Haiku does this now and
// then): a line that starts with the date marker. Without the bullet the brief
// parses as no stories and freshness can't see them.
const UNBULLETED_STORY_RE = /^(`(?:\d{4}-\d{2}-\d{2}|undated)`\s*[—–-])/gm;

/**
 * The topic's `## <topic>` section from a session's answer, with unbulleted
 * stories fixed and stale stories dropped, and its coverage. null when the
 * answer holds no section for the topic.
 */
export function sectionFromAnswer(
  answer: string,
  interest: ResearchInterest,
  now: Date,
): { sectionMd: string; coverage: TopicCoverage } | null {
  const section = extractTopicSection(
    stripBriefPreamble(answer),
    interest.topic,
  );
  if (!section) return null;
  const sectionMd = enforceBriefFreshness(
    section.replace(UNBULLETED_STORY_RE, "- $1"),
    {
      now,
      evergreenKeys: interest.settings?.evergreen
        ? new Set([normalizeTopic(interest.topic)])
        : new Set(),
    },
  );
  const [coverage] = computeCoverage([interest.topic], sectionMd);
  return { sectionMd, coverage };
}
