// The Scout team runner: the Scout team's public topics and every topic of a
// local account (profiles.runs_local), researched on Håkon's own machine with the local `claude` CLI (research.ts, claude-runner.ts) and
// published through the Worker's /team routes (TEAM_PATHS), so readers get
// the brief, its notices and its push exactly as from any run. The only
// difference from the Worker's cron is who does the research.
//
// The runner holds one secret, TEAM_RUNNER_TOKEN, and no Supabase key. It runs
// only with SCOUT_TEAM_RUNNER=on (--dry-run excepted) and only does anything
// while settings.team_runner_on is set in the database; the Scout team's
// public topics only while settings.team_catalog_on is set too (the database
// decides). The Worker's cron never runs these topics, on or off: they never
// spend API dollars.
//
// Not part of the companion: the companion never imports this module.
// scripts/team-run.mts is its command line (`pnpm team:run`).

import type { spawn } from "node:child_process";
import {
  DEFAULT_BRIEF_SETTINGS,
  makeSectionFromAnswer,
  researchInterestOf,
  runLimits,
  sectionFromAnswer,
  TEAM_PATHS,
  type TeamPicksClaim,
  type TeamRun,
  type TeamRunResult,
  type TeamTopic,
} from "#core";
import { answerRelayPrompt } from "./local-relay.js";
import { researchAndSynthesize, writeMakePiece } from "./research.js";

export type TeamRunnerDeps = {
  // The Worker's base URL, e.g. https://scout-runs.<account>.workers.dev
  workerUrl: string;
  token: string;
  fetch?: typeof fetch;
  claudeBin?: string;
  spawnFn?: typeof spawn;
  // Per session. Under the Worker's 10-minute reaper, which fails a run that
  // has been running longer.
  timeoutMs?: number;
  now?: () => Date;
  print?: (line: string) => void;
  // --loop: stops after the current run once aborted (SIGTERM).
  signal?: AbortSignal;
  // --loop: the wait between passes, and how to wait (tests pass a fake).
  loopIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
// A full run of the team's topics stops here, so a stuck queue can't loop.
const DEFAULT_MAX_RUNS = 30;
// --loop: one pass a minute, so a Run now starts within a minute.
const DEFAULT_LOOP_INTERVAL_MS = 60 * 1000;

// Each search and fetch takes a turn; two more to think and write.
export function turnLimit(searches: number, fetches: number): number {
  return searches + fetches + 2;
}

// One topic's research, as the result /team/runs takes. Never throws.
export async function researchTeamRun(
  run: TeamRun,
  deps: TeamRunnerDeps,
): Promise<TeamRunResult> {
  // The same input the Worker's cron gives researchInterest: settings, the
  // last sections ("already posted"), cadence and the last story's date.
  const interest = researchInterestOf(run);
  // The same budget as a hosted run: core's runLimits(doc), under the
  // plan's searches_per_run when that is lower.
  const limits = runLimits(interest.doc);
  const searches =
    run.searchesPerRun > 0
      ? Math.min(run.searchesPerRun, limits.maxSearches)
      : limits.maxSearches;
  const missing = (error: string): TeamRunResult => ({
    runId: run.runId,
    sectionMd: null,
    coverage: { topic: run.topic, status: "missing" },
    error: error.slice(0, 400),
  });
  try {
    if (interest.mode === "make") {
      // Scout writes the piece itself: no web tools, no search budget.
      const out = await writeMakePiece(interest, {
        claudeBin: deps.claudeBin,
        spawnFn: deps.spawnFn,
        timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        now: deps.now?.(),
      });
      const usage = out.usage ?? undefined;
      const piece = makeSectionFromAnswer(out.text, interest);
      if ("error" in piece) return { ...missing(piece.error), usage };
      return { runId: run.runId, ...piece, usage };
    }
    const out = await researchAndSynthesize(interest, {
      claudeBin: deps.claudeBin,
      spawnFn: deps.spawnFn,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxSearches: searches,
      maxFetches: limits.maxFetches,
      maxTurns: turnLimit(searches, limits.maxFetches),
      now: deps.now?.(),
    });
    const usage = out.usage ?? undefined;
    const section = sectionFromAnswer(
      out.text,
      interest,
      deps.now?.() ?? new Date(),
    );
    if (!section) return { ...missing("Claude returned no section"), usage };
    return { runId: run.runId, ...section, usage };
  } catch (err) {
    return missing(err instanceof Error ? err.message : String(err));
  }
}

export class TeamRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// One POST to a /team route with the token. The token is never printed.
async function post<T>(
  deps: TeamRunnerDeps,
  path: string,
  body: unknown,
): Promise<T> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const res = await doFetch(`${deps.workerUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deps.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 200);
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      // Not JSON: keep the raw start.
    }
    throw new TeamRouteError(res.status, `${path}: ${res.status} ${message}`);
  }
  return JSON.parse(text) as T;
}

export const listTeamTopics = async (deps: TeamRunnerDeps) =>
  (await post<{ topics: TeamTopic[] }>(deps, TEAM_PATHS.topics, {})).topics;

// A topic by its interest id or its title (any case).
export function findTopic(
  topics: TeamTopic[],
  wanted: string,
): TeamTopic | undefined {
  const w = wanted.trim().toLowerCase();
  return topics.find(
    (t) => t.interestId.toLowerCase() === w || t.topic.toLowerCase() === w,
  );
}

type Ran = { topic: string; status: TeamRunResult["coverage"]["status"] };

async function runAndPublish(run: TeamRun, deps: TeamRunnerDeps): Promise<Ran> {
  const print = deps.print ?? console.log;
  print(`researching "${run.topic}"…`);
  const result = await researchTeamRun(run, deps);
  await post(deps, TEAM_PATHS.finish, result);
  print(
    `published "${run.topic}": ${result.coverage.status}` +
      (result.error ? ` (${result.error})` : ""),
  );
  return { topic: run.topic, status: result.coverage.status };
}

// Every due scheduled team run, one at a time, until none is left.
export async function runDueTeamTopics(
  deps: TeamRunnerDeps,
  maxRuns = DEFAULT_MAX_RUNS,
): Promise<Ran[]> {
  const ran: Ran[] = [];
  while (ran.length < maxRuns && !deps.signal?.aborted) {
    const { runs } = await post<{ runs: TeamRun[] }>(deps, TEAM_PATHS.claim, {
      limit: 1,
    });
    if (!runs.length) break;
    for (const run of runs) ran.push(await runAndPublish(run, deps));
  }
  return ran;
}

// Local accounts' picks (docs/ARCHITECTURE.md, "Local account relay"): claims
// the readers due new picks, answers each with the local `claude` and hands the
// answer back. One that fails is printed and left; its claim lapses in an hour.
export async function answerDuePicks(deps: TeamRunnerDeps): Promise<number> {
  const print = deps.print ?? console.log;
  const { prompts } = await post<TeamPicksClaim>(deps, TEAM_PATHS.picksClaim, {
    limit: 5,
  });
  let stored = 0;
  for (const prompt of prompts) {
    if (deps.signal?.aborted) break;
    try {
      const answer = await answerRelayPrompt(prompt, {
        claudeBin: deps.claudeBin,
        spawnFn: deps.spawnFn,
      });
      const res = await post<{ stored: boolean }>(
        deps,
        TEAM_PATHS.picksFinish,
        answer,
      );
      if (res.stored) stored++;
    } catch (err) {
      print(
        `picks ${prompt.turnId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (prompts.length) print(`picks: ${stored} of ${prompts.length} stored`);
  return stored;
}

// Resolves after ms, or at once when the signal aborts.
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

// --loop: a pass over the due runs (runDueTeamTopics) and the local
// accounts' picks (answerDuePicks), a pause, again, until the signal aborts. A
// failed step (the Worker unreachable) is printed and the next pass tries again. The launchd service (team-runner-service.ts) runs this.
export async function loopTeamTopics(deps: TeamRunnerDeps): Promise<void> {
  const print = deps.print ?? console.log;
  const sleep = deps.sleep ?? abortableSleep;
  const interval = deps.loopIntervalMs ?? DEFAULT_LOOP_INTERVAL_MS;
  print(`looking for due runs every ${Math.round(interval / 1000)} s…`);
  while (!deps.signal?.aborted) {
    for (const step of [runDueTeamTopics, answerDuePicks]) {
      if (deps.signal?.aborted) break;
      try {
        await step(deps);
      } catch (err) {
        print(err instanceof Error ? err.message : String(err));
      }
    }
    if (deps.signal?.aborted) break;
    await sleep(interval, deps.signal);
  }
  print("stopped.");
}

// A one-off run of one topic, paused or not. The topic stays as it was.
export async function runTeamTopicOnce(
  deps: TeamRunnerDeps,
  wanted: string,
): Promise<Ran> {
  const topic = findTopic(await listTeamTopics(deps), wanted);
  if (!topic) throw new Error(`no Scout team topic "${wanted}"`);
  const { run } = await post<{ run: TeamRun }>(deps, TEAM_PATHS.start, {
    interestId: topic.interestId,
  });
  return runAndPublish(run, deps);
}

// Researches without publishing: the given topic, or every due one. Prints
// each section as it would be published.
export async function dryRun(
  deps: TeamRunnerDeps,
  wanted?: string,
): Promise<TeamRunResult[]> {
  const print = deps.print ?? console.log;
  const topics = await listTeamTopics(deps);
  const picked = wanted
    ? [findTopic(topics, wanted)].filter((t): t is TeamTopic => !!t)
    : topics.filter((t) => t.due);
  if (wanted && !picked.length)
    throw new Error(`no Scout team topic "${wanted}"`);
  if (!picked.length) print("No Scout team topic is due. Try --only <topic>.");
  const results: TeamRunResult[] = [];
  for (const t of picked) {
    print(`researching "${t.topic}" (dry run, nothing is published)…`);
    const result = await researchTeamRun(
      {
        runId: "dry-run",
        topic: t.topic,
        doc: t.doc,
        searchesPerRun: t.searchesPerRun,
        // team_topics carries no settings or history: a dry run uses the
        // defaults and treats the topic as never posted.
        settings: DEFAULT_BRIEF_SETTINGS,
        prior: [],
        cadence: null,
        lastStoryAt: null,
        // team_topics carries no mode either: a dry run researches news.
        mode: "news",
        sentKeys: [],
      },
      deps,
    );
    print(`--- would publish "${t.topic}": ${result.coverage.status}`);
    print(result.sectionMd ?? `(no section: ${result.error})`);
    results.push(result);
  }
  return results;
}

export const TEAM_RUN_USAGE = `pnpm team:run [--dry-run] [--only <topic or id>] [--list] [--loop]

  (none)        research and publish every due Scout team topic and local
                account topic
  --loop        the same every minute until stopped (SIGTERM), and local
                accounts' picks; what the launchd service runs
  install-service / uninstall-service
                start (or remove) --loop as a launchd service on this Mac
  --only <t>    one-off run of one topic, even a paused one; it stays paused
  --dry-run     research and print, publish nothing (no SCOUT_TEAM_RUNNER needed)
  --list        list the Scout team's topics and which are due

Needs SCOUT_TEAM_RUNNER=on, and TEAM_RUNNER_TOKEN and SCOUT_WORKER_URL in
~/.config/scout-hosted/.env (or the environment).`;

// The command line, minus reading files: `config` holds TEAM_RUNNER_TOKEN and
// SCOUT_WORKER_URL. Returns the exit code.
export async function teamRunMain(
  argv: string[],
  env: Record<string, string | undefined>,
  config: Record<string, string | undefined>,
  deps: Omit<TeamRunnerDeps, "workerUrl" | "token"> = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  const flag = (name: string) => argv.includes(name);
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 ? argv[onlyAt + 1] : undefined;
  const known = new Set(["--dry-run", "--only", "--list", "--loop", only]);
  if (
    flag("--help") ||
    (onlyAt >= 0 && !only) ||
    argv.some((a) => !known.has(a))
  ) {
    print(TEAM_RUN_USAGE);
    return flag("--help") ? 0 : 2;
  }

  const dry = flag("--dry-run");
  const list = flag("--list");
  const loop = flag("--loop");
  if (loop && (dry || list || only)) {
    print(TEAM_RUN_USAGE);
    return 2;
  }
  if (!dry && !list && env.SCOUT_TEAM_RUNNER !== "on") {
    print(
      "The Scout team runner is off. Switch it on with SCOUT_TEAM_RUNNER=on " +
        '(see docs/ARCHITECTURE.md, "The Scout team runner"), or try --dry-run.',
    );
    return 1;
  }
  const token = env.TEAM_RUNNER_TOKEN ?? config.TEAM_RUNNER_TOKEN;
  const workerUrl = env.SCOUT_WORKER_URL ?? config.SCOUT_WORKER_URL;
  if (!token || !workerUrl) {
    print(
      "Set TEAM_RUNNER_TOKEN and SCOUT_WORKER_URL in ~/.config/scout-hosted/.env.",
    );
    return 1;
  }
  const full: TeamRunnerDeps = { ...deps, print, token, workerUrl };

  try {
    if (list) {
      for (const t of await listTeamTopics(full))
        print(`${t.due ? "due " : "    "} ${t.topic}  (${t.interestId})`);
      return 0;
    }
    if (dry) {
      await dryRun(full, only);
      return 0;
    }
    if (loop) {
      await loopTeamTopics(full);
      return 0;
    }
    const ran = only
      ? [await runTeamTopicOnce(full, only)]
      : await runDueTeamTopics(full);
    if (!ran.length)
      print(
        "Nothing was due. Is settings.team_runner_on set (and team_catalog_on, for Scout team topics)? Paused topics run only with --only.",
      );
    return ran.some((r) => r.status === "missing") ? 1 : 0;
  } catch (err) {
    if (err instanceof TeamRouteError && err.status === 409)
      print(
        `${err.message}. The runner is on only while settings.team_runner_on is set and Scout is not paused; Scout team topics also need settings.team_catalog_on.`,
      );
    else print(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
