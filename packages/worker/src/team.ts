// The /team routes (TEAM_PATHS in @scout/core): the Scout team runner on
// Håkon's machine and topic hiding. The callers hold a token, never a Supabase
// key; these routes call the team_* SQL functions with the service key, and
// those touch only the Scout team's public topics (hide: any public topic).
//
//   TEAM_RUNNER_TOKEN  /team/topics, /team/claim, /team/start, /team/runs,
//                      /team/picks/claim, /team/picks/finish (local readers'
//                      picks through the relay, core's relay.ts)
//   MODERATION_TOKEN   /team/hide
//
// A route whose token is unset does not exist (404). No CORS: a browser page
// cannot call them. Host-neutral: Request and Response only.

import {
  claimedRunFromRow,
  TEAM_PATHS,
  type ClaimedRunRow,
  parseRelayAnswer,
  type CliUsage,
  type RelayPrompt,
  type TeamPicksClaim,
  type TeamRunResult,
  type TeamTopic,
  type TopicCoverage,
} from "@scout/core";
import { createPicks, type PicksJob, type PicksStore } from "@scout/hosted";
import { captureRequest } from "@scout/research";
import { MAX_RELAY_TEXT_CHARS, relayClaude } from "./relay.ts";
import {
  bearerToken,
  jsonResponder,
  readJsonBody,
  sameSecret,
} from "./request.ts";
import {
  RpcError,
  picksJobFromRow,
  rpcCaller,
  supabasePicksStore,
  type PicksJobRow,
} from "./supabase.ts";

export type TeamDeps = {
  supabaseUrl: string;
  serviceKey?: string;
  teamToken?: string;
  moderationToken?: string;
  fetch?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["covered", "empty", "missing"]);
// The runner works one run at a time (the Worker's reaper fails a run that has
// been running for 10 minutes); a few is the most it may hold.
const MAX_CLAIM = 3;
// Picks prompts are small; the gateway answers them one after another.
const MAX_PICKS_CLAIM = 5;
const MAX_REASON_CHARS = 500;
const MAX_SECTION_CHARS = 40_000;
// Room for the largest section (4 bytes a character at most) and the rest.
const MAX_BODY_BYTES = 192 * 1024;

export function isTeamPath(path: string): boolean {
  return (Object.values(TEAM_PATHS) as string[]).includes(path);
}

const json = jsonResponder();

export async function handleTeamRequest(
  request: Request,
  deps: TeamDeps,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const token =
    path === TEAM_PATHS.hide ? deps.moderationToken : deps.teamToken;
  if (!token || !deps.serviceKey) return json(404, { error: "not found" });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });

  const given = bearerToken(request);
  if (!given || !(await sameSecret(given, token)))
    return json(401, { error: "wrong token" });

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read) return json(413, { error: "that request is too large" });
  // An empty or garbled body reads as {}; each route checks its fields.
  const body: Record<string, unknown> =
    read.body && typeof read.body === "object"
      ? (read.body as Record<string, unknown>)
      : {};

  const rpc = rpcCaller(deps.supabaseUrl, deps.fetch);
  const service = { apikey: deps.serviceKey, bearer: deps.serviceKey };
  const call = (fn: string, args: Record<string, unknown>) =>
    rpc(fn, args, service);

  try {
    switch (path) {
      case TEAM_PATHS.topics: {
        const rows = (await call("team_topics", {})) as TopicRow[];
        const topics: TeamTopic[] = rows.map((r) => ({
          interestId: r.interest_id,
          topic: r.topic,
          doc: r.doc,
          searchesPerRun: r.searches_per_run,
          due: r.due,
        }));
        return json(200, { topics });
      }
      case TEAM_PATHS.claim: {
        const limit = Number.isInteger(body.limit)
          ? Math.max(0, Math.min(MAX_CLAIM, body.limit as number))
          : 1;
        const rows = (await call("team_claim_runs", {
          p_limit: limit,
        })) as ClaimedRunRow[];
        return json(200, { runs: rows.map(claimedRunFromRow) });
      }
      case TEAM_PATHS.start: {
        if (typeof body.interestId !== "string" || !UUID.test(body.interestId))
          return json(400, { error: "interestId must be an interest's id" });
        const rows = (await call("team_start_run", {
          p_interest: body.interestId,
        })) as ClaimedRunRow[];
        return json(200, { run: claimedRunFromRow(rows[0]) });
      }
      case TEAM_PATHS.finish: {
        const result = parseResult(body);
        if (!result)
          return json(400, { error: "that result isn't one Scout reads" });
        await call("team_finish_run", {
          p_run: result.runId,
          p_section_md: result.sectionMd,
          p_coverage: result.coverage,
          p_error: result.error ?? null,
          // Sent only when present, so a Worker ahead of the migration that
          // adds it still records the run.
          ...(result.usage ? { p_usage: result.usage } : {}),
        });
        // finish_run queues the readers' pushes (outbox), as for any run.
        return json(200, { ok: true });
      }
      case TEAM_PATHS.picksClaim: {
        const limit = Number.isInteger(body.limit)
          ? Math.max(0, Math.min(MAX_PICKS_CLAIM, body.limit as number))
          : 1;
        const rows = ((await call("team_claim_picks", { p_limit: limit })) ??
          []) as PicksJobRow[];
        const prompts: RelayPrompt[] = [];
        for (const job of rows.map(picksJobFromRow)) {
          // A reader with no candidates is finished here, with no model call.
          const out = await captureRequest((claude) =>
            createPicks({ claude, store: oneJobStore(job, deps) }).refresh(1),
          );
          if ("captured" in out)
            prompts.push({ turnId: String(job.runId), request: out.captured });
        }
        const claimed: TeamPicksClaim = { prompts };
        return json(200, claimed);
      }
      case TEAM_PATHS.picksFinish: {
        const answer = parseRelayAnswer(body, MAX_RELAY_TEXT_CHARS);
        if (!answer || !/^\d{1,18}$/.test(answer.turnId))
          return json(400, { error: "that answer isn't one Scout reads" });
        const job = picksJobFromRow(
          (await call("team_pick_job", {
            p_run: Number(answer.turnId),
          })) as PicksJobRow,
        );
        // parsePicks decides what lands, as for an API answer.
        const result = await createPicks({
          claude: relayClaude(answer),
          store: oneJobStore(job, deps),
        }).refresh(1);
        return json(200, { stored: result.stored === 1 });
      }
      case TEAM_PATHS.hide: {
        const reason =
          typeof body.reason === "string" ? body.reason.trim() : "";
        if (typeof body.interestId !== "string" || !UUID.test(body.interestId))
          return json(400, { error: "interestId must be an interest's id" });
        if (!reason || reason.length > MAX_REASON_CHARS)
          return json(400, {
            error: `give a reason of at most ${MAX_REASON_CHARS} characters`,
          });
        const hidden = (await call("team_hide_interest", {
          p_interest: body.interestId,
          p_reason: reason,
          p_actor: "moderation-token",
        })) as boolean;
        return json(200, { hidden });
      }
    }
    return json(404, { error: "not found" });
  } catch (err) {
    if (err instanceof RpcError) {
      if (err.code === "55000")
        return json(409, { error: "the team runner is off" });
      if (err.code === "23505")
        return json(409, { error: "this topic already has a run going" });
      if (err.code === "P0002") return json(404, { error: err.message });
    }
    console.error(`[team] ${path} failed:`, err);
    return json(502, { error: "Supabase did not answer" });
  }
}

// The picks store for one claimed local reader: the claim is already made,
// and the call is recorded at no cost (the Mac's `claude`, not the API).
function oneJobStore(job: PicksJob, deps: TeamDeps): PicksStore {
  const store = supabasePicksStore({
    url: deps.supabaseUrl,
    serviceKey: deps.serviceKey as string,
    fetch: deps.fetch,
  });
  return {
    claim: async () => [job],
    finish: (j, picks, _costUsd, error, tokens) =>
      store.finish(j, picks, 0, error, tokens),
  };
}

type TopicRow = {
  interest_id: string;
  topic: string;
  doc: string;
  searches_per_run: number;
  due: boolean;
};
function parseResult(b: Record<string, unknown>): TeamRunResult | null {
  const c = b.coverage as Partial<TopicCoverage> | undefined;
  const ok =
    typeof b.runId === "string" &&
    UUID.test(b.runId) &&
    (b.sectionMd === null ||
      (typeof b.sectionMd === "string" &&
        b.sectionMd.length <= MAX_SECTION_CHARS)) &&
    typeof c?.topic === "string" &&
    typeof c.status === "string" &&
    STATUSES.has(c.status) &&
    (b.error === undefined || typeof b.error === "string");
  if (!ok) return null;
  const usage = parseUsage(b.usage);
  return {
    runId: b.runId as string,
    sectionMd: b.sectionMd as string | null,
    coverage: { topic: c.topic, status: c.status } as TopicCoverage,
    ...(typeof b.error === "string" ? { error: b.error.slice(0, 400) } : {}),
    ...(usage ? { usage } : {}),
  };
}

// The session's usage, rebuilt from known fields only. Bad numbers count as
// 0; a usage that is not an object is dropped (the run is still recorded).
function parseUsage(u: unknown): CliUsage | undefined {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return undefined;
  const r = u as Record<string, unknown>;
  const count = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : null);
  return {
    model: text(r.model),
    stopReason: text(r.stopReason),
    turns: count(r.turns),
    inputTokens: count(r.inputTokens),
    outputTokens: count(r.outputTokens),
    cacheReadTokens: count(r.cacheReadTokens),
    cacheWriteTokens: count(r.cacheWriteTokens),
    webSearches: count(r.webSearches),
    webFetches: typeof r.webFetches === "number" ? count(r.webFetches) : null,
    costUsd: count(r.costUsd),
  };
}
