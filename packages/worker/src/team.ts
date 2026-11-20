// The /team routes (TEAM_PATHS in @scout/core): the Scout team runner on
// Håkon's machine and topic hiding. The callers hold a token, never a Supabase
// key; these routes call the team_* SQL functions with the service key, and
// those touch only the Scout team's public topics (hide: any public topic).
//
//   TEAM_RUNNER_TOKEN  /team/topics, /team/claim, /team/start, /team/runs
//   MODERATION_TOKEN   /team/hide
//
// A route whose token is unset does not exist (404). No CORS: a browser page
// cannot call them. Host-neutral: Request and Response only.

import {
  TEAM_PATHS,
  type TeamRun,
  type TeamRunResult,
  type TeamTopic,
  type TopicCoverage,
} from "@scout/core";
import { RpcError, rpcCaller } from "./supabase.ts";

export type TeamDeps = {
  supabaseUrl: string;
  serviceKey?: string;
  teamToken?: string;
  moderationToken?: string;
  // Tells a ready run's readers (push.ts), as the cron tick does.
  notify?: (runId: string) => Promise<void>;
  fetch?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["covered", "empty", "missing"]);
// The runner works one run at a time (the Worker's reaper fails a run that has
// been running for 10 minutes); a few is the most it may hold.
const MAX_CLAIM = 3;
const MAX_REASON_CHARS = 500;
const MAX_SECTION_CHARS = 40_000;

export function isTeamPath(path: string): boolean {
  return (Object.values(TEAM_PATHS) as string[]).includes(path);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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

  const given = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!given || !(await sameSecret(given, token)))
    return json(401, { error: "wrong token" });

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object")
      body = parsed as Record<string, unknown>;
  } catch {
    // An empty or garbled body reads as {}; each route checks its fields.
  }

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
        })) as RunRow[];
        return json(200, { runs: rows.map(teamRun) });
      }
      case TEAM_PATHS.start: {
        if (typeof body.interestId !== "string" || !UUID.test(body.interestId))
          return json(400, { error: "interestId must be an interest's id" });
        const rows = (await call("team_start_run", {
          p_interest: body.interestId,
        })) as RunRow[];
        return json(200, { run: teamRun(rows[0]) });
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
        });
        // The same rule as the cron tick: a push only for a brief with
        // stories, and a push failure is never the run's.
        if (deps.notify && result.coverage.status === "covered")
          await deps.notify(result.runId).catch(() => undefined);
        return json(200, { ok: true });
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

type TopicRow = {
  interest_id: string;
  topic: string;
  doc: string;
  searches_per_run: number;
  due: boolean;
};
type RunRow = {
  run_id: string;
  topic: string;
  doc: string;
  searches_per_run: number;
};

function teamRun(r: RunRow): TeamRun {
  return {
    runId: r.run_id,
    topic: r.topic,
    doc: r.doc,
    searchesPerRun: r.searches_per_run,
  };
}

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
  return {
    runId: b.runId as string,
    sectionMd: b.sectionMd as string | null,
    coverage: { topic: c.topic, status: c.status } as TopicCoverage,
    ...(typeof b.error === "string" ? { error: b.error.slice(0, 400) } : {}),
  };
}

// Compares two secrets in time that does not depend on where they differ:
// their SHA-256 digests, byte by byte, all the way through.
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all(
    [a, b].map(
      async (s) =>
        new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))),
    ),
  );
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}
