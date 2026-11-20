// The Supabase side of the run queue, over PostgREST with plain fetch (no
// supabase-js: less to bundle and less CPU per tick). Host-neutral.

import {
  briefSettingsFromRow,
  type BriefSettingsRow,
  type PicksInput,
} from "@scout/core";
import type { PicksJob, PicksStore } from "@scout/hosted";
import type { OutboxPush, PushStore } from "./push.ts";
import type { ClaimedRun, RunOutcome, RunQueue } from "./run-due.ts";

type Fetch = typeof fetch;

// The service-role queue: claim_runs and finish_run (supabase/migrations).
// The key comes from the host's secret store and is never logged.
export function supabaseQueue(opts: {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
}): RunQueue {
  const rpc = rpcCaller(opts.url, opts.fetch);
  const auth = { apikey: opts.serviceKey, bearer: opts.serviceKey };
  return {
    async claim(limit) {
      const rows = (await rpc("claim_runs", { p_limit: limit }, auth)) as Array<
        Partial<BriefSettingsRow> & {
          run_id: string;
          topic: string;
          doc: string;
          searches_per_run: number;
          prior?: Array<{ date: string; section_md: string }> | null;
          cadence?: string | null;
          last_story_at?: string | null;
        }
      >;
      return rows.map(
        (r): ClaimedRun => ({
          runId: r.run_id,
          topic: r.topic,
          doc: r.doc,
          searchesPerRun: r.searches_per_run,
          settings: briefSettingsFromRow(r),
          prior: (r.prior ?? []).map((p) => ({
            date: p.date,
            markdown: p.section_md,
          })),
          cadence:
            r.cadence === "daily" || r.cadence === "weekly" ? r.cadence : null,
          lastStoryAt: r.last_story_at ?? null,
        }),
      );
    },
    async finish(runId, outcome: RunOutcome) {
      await rpc(
        "finish_run",
        {
          p_run: runId,
          p_section_md: outcome.sectionMd,
          p_coverage: outcome.coverage,
          p_searches: outcome.searches,
          p_cost_usd: outcome.costUsd,
          p_error: outcome.error ?? null,
          p_retry: outcome.retry ?? true,
        },
        auth,
      );
    },
  };
}

// The service-role push store: claim_outbox, and deleting gone devices
// (supabase/migrations/*_push_outbox.sql).
export function supabasePushStore(opts: {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
}): PushStore {
  const doFetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  const rpc = rpcCaller(opts.url, doFetch);
  const auth = { apikey: opts.serviceKey, bearer: opts.serviceKey };
  return {
    async claim(limit) {
      return (
        ((await rpc("claim_outbox", { p_limit: limit }, auth)) as
          | OutboxPush[]
          | null) ?? []
      );
    },
    async drop(endpoints) {
      // PostgREST's in-list, each value double-quoted (endpoints hold commas).
      const list = endpoints
        .map((e) => `"${e.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
        .join(",");
      const res = await doFetch(
        `${opts.url}/rest/v1/push_subscriptions?endpoint=${encodeURIComponent(`in.(${list})`)}`,
        {
          method: "DELETE",
          headers: {
            apikey: opts.serviceKey,
            authorization: `Bearer ${opts.serviceKey}`,
            prefer: "return=minimal",
          },
        },
      );
      if (!res.ok) throw new Error(`push_subscriptions delete: ${res.status}`);
    },
  };
}

// The service-role picks store: claim_picks and finish_picks
// (supabase/migrations/*_picks.sql).
export function supabasePicksStore(opts: {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
}): PicksStore {
  const rpc = rpcCaller(opts.url, opts.fetch);
  const auth = { apikey: opts.serviceKey, bearer: opts.serviceKey };
  return {
    async claim(limit) {
      const rows = ((await rpc("claim_picks", { p_limit: limit }, auth)) ??
        []) as Array<{
        user_id: string;
        run_id: number;
        kind: PicksJob["kind"];
        input: PicksInput;
      }>;
      return rows.map((r) => ({
        userId: r.user_id,
        runId: r.run_id,
        kind: r.kind,
        input: r.input,
      }));
    },
    async finish(job, picks, costUsd, error) {
      await rpc(
        "finish_picks",
        {
          p_user: job.userId,
          p_run: job.runId,
          p_picks:
            picks?.map((p) => ({
              interest_id: p.interestId,
              reason: p.reason,
            })) ?? null,
          p_cost: costUsd,
          p_error: error,
        },
        auth,
      );
    },
  };
}

// The daily job (the "17 3 * * *" cron): delete runs over 30 days old (each
// interest keeps its latest brief) and stale outbox rows; on Mondays, mark
// active readers for a picks refresh, then queue the weekly digest pushes of
// everyone else (a marked reader's goes out once their picks are made).
export async function dailyJobs(opts: {
  url: string;
  serviceKey: string;
  now?: Date;
  fetch?: Fetch;
}): Promise<{
  runsDeleted: number;
  weeklyPicks: number;
  weeklyQueued: number;
}> {
  const rpc = rpcCaller(opts.url, opts.fetch);
  const auth = { apikey: opts.serviceKey, bearer: opts.serviceKey };
  const runsDeleted = (await rpc("cleanup_runs", {}, auth)) as number;
  const monday = (opts.now ?? new Date()).getUTCDay() === 1;
  if (!monday) return { runsDeleted, weeklyPicks: 0, weeklyQueued: 0 };
  const weeklyPicks = (await rpc("start_weekly_picks", {}, auth)) as number;
  const weeklyQueued = (await rpc("queue_weekly_pushes", {}, auth)) as number;
  return { runsDeleted, weeklyPicks, weeklyQueued };
}

export class RpcError extends Error {
  constructor(
    readonly status: number,
    // The Postgres error code PostgREST passes on (P0001 quota, P0002 not found).
    readonly code: string | undefined,
    message: string,
    // The Postgres hint: for a quota refusal, the limit's name (max_interests).
    readonly hint?: string,
  ) {
    super(message);
  }
}

// A reader's "run now": request_run as that reader, so Supabase checks their
// JWT and RLS and the SQL checks their daily limit. Returns the run id.
export async function requestRun(opts: {
  url: string;
  anonKey: string;
  userJwt: string;
  interestId: string;
  fetch?: Fetch;
}): Promise<string> {
  const rpc = rpcCaller(opts.url, opts.fetch);
  return (await rpc(
    "request_run",
    { p_interest: opts.interestId },
    { apikey: opts.anonKey, bearer: opts.userJwt },
  )) as string;
}

export function rpcCaller(baseUrl: string, doFetch: Fetch = globalThis.fetch) {
  return async (
    fn: string,
    args: Record<string, unknown>,
    auth: { apikey: string; bearer: string },
  ): Promise<unknown> => {
    const res = await doFetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: auth.apikey,
        authorization: `Bearer ${auth.bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) {
      let code: string | undefined;
      let hint: string | undefined;
      let message = text.slice(0, 300);
      try {
        const err = JSON.parse(text) as {
          code?: string;
          hint?: string | null;
          message?: string;
        };
        code = err.code;
        hint = err.hint ?? undefined;
        if (err.message) message = err.message;
      } catch {
        // Not JSON: keep the raw start.
      }
      throw new RpcError(res.status, code, `${fn}: ${message}`, hint);
    }
    return text ? JSON.parse(text) : null;
  };
}
