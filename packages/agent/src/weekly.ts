import { createWeeklyBriefFromHistory, type Brief } from "#core";
import { BRIEF_HISTORY_CAP, updateState } from "./state.js";

// Build the weekly digest from saved history and keep it as the newest brief.
export async function createAndPersistWeeklyBrief(
  stateFile: string,
  now = new Date(),
): Promise<Brief> {
  let brief: Brief | undefined;
  await updateState(stateFile, (state) => {
    const prior = state.briefs ?? [];
    const weekly = createWeeklyBriefFromHistory(prior, now);
    brief = weekly;
    const briefs = [weekly, ...prior.filter((b) => b.id !== weekly.id)].slice(
      0,
      BRIEF_HISTORY_CAP,
    );
    return { ...state, last_brief: weekly, briefs };
  });
  return brief!;
}
