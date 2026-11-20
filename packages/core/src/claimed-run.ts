// A claimed hosted run: what the SQL's claim_runs, team_claim_runs and
// team_start_run return (one row shape, run_facts in
// supabase/migrations/*_team_run_facts.sql), and the research input it makes.
// The Worker's cron (packages/worker/src/run-due.ts) and the Scout team runner
// (packages/agent/src/team-runner.ts) both read runs through these, so a team
// topic's prompt gets the same settings and history as any other.

import {
  briefSettingsFromRow,
  type BriefSettingsRow,
} from "./brief-settings.ts";
import type { BriefSettings } from "./contract.ts";
import type { PriorBrief, ResearchInterest } from "./research-prompt.ts";

// A run already marked running, with what its research needs.
export type ClaimedRun = {
  runId: string;
  topic: string;
  doc: string;
  searchesPerRun: number;
  settings: BriefSettings;
  // The interest's last ready sections, newest first: "already reported".
  prior: PriorBrief[];
  cadence: "daily" | "weekly" | null;
  // When the interest last had a story (ISO); null: never.
  lastStoryAt: string | null;
};

// One row as PostgREST returns it.
export type ClaimedRunRow = Partial<BriefSettingsRow> & {
  run_id: string;
  topic: string;
  doc: string;
  searches_per_run: number;
  prior?: Array<{ date: string; section_md: string }> | null;
  cadence?: string | null;
  last_story_at?: string | null;
};

export function claimedRunFromRow(r: ClaimedRunRow): ClaimedRun {
  return {
    runId: r.run_id,
    topic: r.topic,
    doc: r.doc,
    searchesPerRun: r.searches_per_run,
    settings: briefSettingsFromRow(r),
    prior: (r.prior ?? []).map((p) => ({
      date: p.date,
      markdown: p.section_md,
    })),
    cadence: r.cadence === "daily" || r.cadence === "weekly" ? r.cadence : null,
    lastStoryAt: r.last_story_at ?? null,
  };
}

// The research prompt's input for a claimed run.
export function researchInterestOf(run: ClaimedRun): ResearchInterest {
  return {
    topic: run.topic,
    doc: run.doc,
    settings: run.settings,
    prior: run.prior,
    cadence: run.cadence,
    lastPosted: run.lastStoryAt,
  };
}
