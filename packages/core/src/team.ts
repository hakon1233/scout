// The Worker's /team routes, shared by the Worker (packages/worker/src/team.ts)
// and the Scout team runner (packages/agent/src/team-runner.ts). Every route is
// a POST with `Authorization: Bearer <token>`: TEAM_RUNNER_TOKEN for the
// runner's routes, MODERATION_TOKEN for /team/hide.

import type { TopicCoverage } from "./contract.ts";

export const TEAM_PATHS = {
  // {} -> { topics: TeamTopic[] }. Read only; works with the runner off.
  topics: "/team/topics",
  // { limit } -> { runs: TeamRun[] }. The team's due scheduled runs.
  claim: "/team/claim",
  // { interestId } -> { run: TeamRun }. A one-off run of one topic.
  start: "/team/start",
  // TeamRunResult -> { ok: true }. Records the run and sends its pushes.
  finish: "/team/runs",
  // { interestId, reason } -> { hidden: boolean }. Hides a public topic.
  hide: "/team/hide",
} as const;

export type TeamTopic = {
  interestId: string;
  topic: string;
  doc: string;
  searchesPerRun: number;
  // Its scheduled slot has no run yet. Never true for a paused topic.
  due: boolean;
};

// A run the team runner owns, already marked running.
export type TeamRun = {
  runId: string;
  topic: string;
  doc: string;
  searchesPerRun: number;
};

export type TeamRunResult = {
  runId: string;
  // null: the attempt failed (coverage "missing", `error` says why).
  sectionMd: string | null;
  coverage: TopicCoverage;
  error?: string;
};
