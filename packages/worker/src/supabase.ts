// The Supabase side of the run queue, over PostgREST with plain fetch (no
// supabase-js: less to bundle and less CPU per tick). Host-neutral.

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
      const rows = (await rpc(
        "claim_runs",
        { p_limit: limit },
        auth,
      )) as Array<{
        run_id: string;
        topic: string;
        doc: string;
        searches_per_run: number;
      }>;
      return rows.map(
        (r): ClaimedRun => ({
          runId: r.run_id,
          topic: r.topic,
          doc: r.doc,
          searchesPerRun: r.searches_per_run,
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
        },
        auth,
      );
    },
  };
}

export class RpcError extends Error {
  constructor(
    readonly status: number,
    // The Postgres error code PostgREST passes on (P0001 quota, P0002 not found).
    readonly code: string | undefined,
    message: string,
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
      let message = text.slice(0, 300);
      try {
        const err = JSON.parse(text) as { code?: string; message?: string };
        code = err.code;
        if (err.message) message = err.message;
      } catch {
        // Not JSON: keep the raw start.
      }
      throw new RpcError(res.status, code, `${fn}: ${message}`);
    }
    return text ? JSON.parse(text) : null;
  };
}
