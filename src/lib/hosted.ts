// The hosted app's data: the signed-in reader's interests, their latest brief,
// their plan's allowance, the setup chat and run-now. The one module hosted
// screens call; components never fetch or touch Supabase themselves.
//
// Reads and the reader's own edits go to Supabase's REST API as the reader
// (their JWT, so RLS and the quota trigger apply). The chat and run-now go to
// the Worker (packages/worker), which verifies the same JWT. Plain fetch: only
// auth.ts holds supabase-js. Errors reach callers as a HostedError whose
// message is written for the reader.

import {
  assembleBrief,
  type ChatConfirm,
  type ChatTurn,
  type ChatTurnRow,
  type TopicCoverage,
  chatTurnFromRow,
} from "@scout/core";
import { hostedAuth, hostedConfig } from "./auth";
import { parseArticlesFromMarkdown } from "./companion";
import type { Brief } from "./types";

export type Cadence = "daily" | "weekly" | "off";

export type HostedInterest = {
  id: string;
  topic: string;
  cadence: Cadence;
  // Someone else's public interest the reader follows: no schedule of its own
  // to set and no run-now, only unfollow.
  following: boolean;
  // A run waiting in the queue or being researched now.
  run: "queued" | "running" | null;
  // When the latest brief section for it was written, or null for none yet.
  updatedAt: string | null;
  // Set when the newest run failed and nothing newer is ready: why, for the reader.
  failed: string | null;
};

export type Allowance = {
  plan: string;
  daily: { used: number; limit: number };
  weekly: { used: number; limit: number };
  runsToday: { used: number; limit: number };
};

export type HostedHome = {
  interests: HostedInterest[];
  // The latest section of every interest, as one brief. Null before the first.
  brief: Brief | null;
  allowance: Allowance;
};

export interface HostedData {
  home(): Promise<HostedHome>;
  // The reader's recent chat turns, oldest first.
  transcript(): Promise<ChatTurn[]>;
  chat(message: string): Promise<ChatTurn>;
  confirm(action: ChatConfirm): Promise<ChatTurn>;
  setCadence(interestId: string, cadence: Cadence): Promise<void>;
  // Soft delete, and its undo.
  remove(interestId: string): Promise<void>;
  restore(interestId: string): Promise<void>;
  unfollow(interestId: string): Promise<void>;
  runNow(interestId: string): Promise<void>;
}

/** A failure with a message the page can show as is. `limit` means the
 *  reader's plan said no; `signed-out` means the session is gone. */
export class HostedError extends Error {
  override name = "HostedError";
  constructor(
    readonly kind: "limit" | "signed-out" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export type Session = { userId: string; accessToken: string };

type Fetch = typeof fetch;
const TRANSCRIPT_TURNS = 30;
const RUN_HISTORY = 200;

export function createHostedData(deps: {
  supabaseUrl: string;
  anonKey: string;
  workerUrl: string;
  session: () => Promise<Session | null>;
  fetch?: Fetch;
}): HostedData {
  const doFetch: Fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));

  async function session(): Promise<Session> {
    const s = await deps.session();
    if (!s) throw new HostedError("signed-out", "Sign in to see your briefs.");
    return s;
  }

  async function call(
    url: string,
    init: { method: string; body?: unknown; prefer?: string },
    s: Session,
    apikey = true,
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${s.accessToken}`,
    };
    if (apikey) headers.apikey = deps.anonKey;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.prefer) headers.prefer = init.prefer;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new HostedError(
        "failed",
        "Scout can't be reached. Check your connection and try again.",
      );
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (res.status === 401)
      throw new HostedError("signed-out", "Your session ended. Sign in again.");
    return { status: res.status, body };
  }

  async function rest<T>(
    path: string,
    init: { method?: string; body?: unknown; prefer?: string } = {},
  ): Promise<T> {
    const s = await session();
    const { status, body } = await call(
      `${deps.supabaseUrl}/rest/v1/${path}`,
      { method: init.method ?? "GET", body: init.body, prefer: init.prefer },
      s,
    );
    if (status >= 400) throw restError(body);
    return body as T;
  }

  async function worker(path: string, payload: unknown): Promise<unknown> {
    if (!deps.workerUrl)
      throw new HostedError("failed", "This build has no Scout server set up.");
    const s = await session();
    const { status, body } = await call(
      `${deps.workerUrl}${path}`,
      { method: "POST", body: payload },
      s,
      false,
    );
    if (status < 400) return body;
    const said = (body as { error?: string } | null)?.error ?? "";
    if (status === 429)
      throw new HostedError("limit", workerLimitMessage(path, said));
    if (status === 409)
      throw new HostedError(
        "failed",
        "That was already settled. Send a new message.",
      );
    throw new HostedError("failed", "Something went wrong. Try again.");
  }

  async function patchInterest(id: string, fields: Record<string, unknown>) {
    await rest(`interests?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: fields,
      prefer: "return=minimal",
    });
  }

  return {
    async home() {
      const s = await session();
      const user = encodeURIComponent(s.userId);
      const [own, follows, allowance] = await Promise.all([
        rest<InterestRow[]>(
          `interests?select=id,topic,cadence&owner_id=eq.${user}&deleted_at=is.null&order=created_at.asc`,
        ),
        rest<{ interests: { id: string; topic: string } | null }[]>(
          `follows?select=interests(id,topic)&user_id=eq.${user}&order=created_at.asc`,
        ),
        rest<AllowanceRow>("rpc/allowance", {
          method: "POST",
          body: { p_user: s.userId },
        }),
      ]);
      const rows: (InterestRow & { following: boolean })[] = [
        ...own.map((i) => ({ ...i, following: false })),
        ...follows
          .map((f) => f.interests)
          .filter((i): i is { id: string; topic: string } => i !== null)
          .map((i) => ({ ...i, cadence: "off" as Cadence, following: true })),
      ];
      const runs =
        rows.length === 0
          ? []
          : await rest<RunRow[]>(
              `runs?select=id,interest_id,status,section_md,coverage,error_msg,created_at,finished_at&interest_id=in.(${rows
                .map((r) => encodeURIComponent(r.id))
                .join(",")})&order=created_at.desc&limit=${RUN_HISTORY}`,
            );
      return assembleHome(rows, runs, allowance);
    },

    async transcript() {
      const s = await session();
      const rows = await rest<ChatTurnRow[]>(
        `chat_turns?select=id,created_at,status,message,reply,changes,pending,error_msg&user_id=eq.${encodeURIComponent(s.userId)}&order=created_at.desc&limit=${TRANSCRIPT_TURNS}`,
      );
      return rows.reverse().map(chatTurnFromRow);
    },

    async chat(message) {
      return (await worker("/chat", { message })) as ChatTurn;
    },

    async confirm(action) {
      return (await worker("/chat/confirm", action)) as ChatTurn;
    },

    async setCadence(interestId, cadence) {
      await patchInterest(interestId, { cadence });
    },

    async remove(interestId) {
      await patchInterest(interestId, { deleted_at: new Date().toISOString() });
    },

    async restore(interestId) {
      await patchInterest(interestId, { deleted_at: null });
    },

    async unfollow(interestId) {
      const s = await session();
      await rest(
        `follows?user_id=eq.${encodeURIComponent(s.userId)}&interest_id=eq.${encodeURIComponent(interestId)}`,
        { method: "DELETE", prefer: "return=minimal" },
      );
    },

    async runNow(interestId) {
      await worker("/runs", { interestId });
    },
  };
}

type InterestRow = { id: string; topic: string; cadence: Cadence };

type RunRow = {
  id: string;
  interest_id: string;
  status: "queued" | "running" | "ready" | "failed";
  section_md: string | null;
  coverage: TopicCoverage | null;
  error_msg: string | null;
  created_at: string;
  finished_at: string | null;
};

type AllowanceRow = {
  plan: string;
  used: {
    daily_interests: number;
    weekly_interests: number;
    on_demand_runs_today: number;
  };
  limits: {
    daily_interests: number;
    weekly_interests: number;
    on_demand_runs_per_day: number;
  };
};

// Runs come newest first. Per interest: the run in flight, the newest ready
// section, and a failure only when it is newer than that section.
function assembleHome(
  rows: (InterestRow & { following: boolean })[],
  runs: RunRow[],
  a: AllowanceRow,
): HostedHome {
  const sections: { topic: string; section: string }[] = [];
  const coverage: TopicCoverage[] = [];
  let newest: RunRow | null = null;

  const interests = rows.map((row): HostedInterest => {
    const mine = runs.filter((r) => r.interest_id === row.id);
    const active = mine.find(
      (r) => r.status === "queued" || r.status === "running",
    );
    const ready = mine.find((r) => r.status === "ready" && r.section_md);
    const lastDone = mine.find(
      (r) => r.status === "ready" || r.status === "failed",
    );
    if (ready?.section_md) {
      sections.push({ topic: row.topic, section: ready.section_md });
      if (ready.coverage) coverage.push(ready.coverage);
      if (!newest || doneAt(ready) > doneAt(newest)) newest = ready;
    }
    return {
      id: row.id,
      topic: row.topic,
      cadence: row.cadence,
      following: row.following,
      run: active ? (active.status as "queued" | "running") : null,
      updatedAt: ready ? doneAt(ready) : null,
      failed:
        lastDone?.status === "failed"
          ? "The last run failed. Run it again, or wait for the next one."
          : null,
    };
  });

  let brief: Brief | null = null;
  const latest = newest as RunRow | null;
  if (latest) {
    const markdown = assembleBrief(sections);
    const id = `hosted-${latest.id}`;
    const parsed = parseArticlesFromMarkdown(markdown, id);
    brief = {
      id,
      generatedAt: doneAt(latest),
      interests: parsed.interests,
      articles: parsed.articles,
      markdown,
      topics: coverage,
    };
  }

  return {
    interests,
    brief,
    allowance: {
      plan: a.plan,
      daily: { used: a.used.daily_interests, limit: a.limits.daily_interests },
      weekly: {
        used: a.used.weekly_interests,
        limit: a.limits.weekly_interests,
      },
      runsToday: {
        used: a.used.on_demand_runs_today,
        limit: a.limits.on_demand_runs_per_day,
      },
    },
  };
}

function doneAt(r: RunRow): string {
  return r.finished_at ?? r.created_at;
}

// PostgREST's error body: the quota trigger raises P0001 with the limit's name
// as the hint.
function restError(body: unknown): HostedError {
  const err = (body ?? {}) as {
    code?: string;
    hint?: string;
    message?: string;
  };
  if (err.code === "P0001") {
    const limit = /of (\d+)/.exec(err.message ?? "")?.[1];
    if (err.hint === "daily_interests")
      return new HostedError(
        "limit",
        `Your plan has room for ${plural(limit, "daily interest")}, and it's in use. Set one to weekly or pause it first.`,
      );
    if (err.hint === "weekly_interests")
      return new HostedError(
        "limit",
        `Your plan has room for ${plural(limit, "weekly interest")}, and they're in use. Pause one first.`,
      );
    if (err.hint === "max_interests")
      return new HostedError(
        "limit",
        `Your plan has room for ${plural(limit, "interest")}, and they're in use. Delete one first.`,
      );
    if (err.hint === "max_doc_chars")
      return new HostedError(
        "limit",
        "That interest's description is too long for your plan.",
      );
  }
  return new HostedError("failed", "Couldn't save that. Try again.");
}

function workerLimitMessage(path: string, said: string): string {
  if (path === "/runs") {
    const limit = /of (\d+)/.exec(said)?.[1];
    return `You've used today's ${plural(limit, "run")}. Scheduled briefs still come.`;
  }
  // The chat's refusals are already written for the reader (chat_block_reason).
  return said || "Scout has paused new work for now. Try again later.";
}

function plural(n: string | number | undefined, word: string): string {
  if (n === undefined) return `${word}s`;
  return `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
}

/** What the reader's plan has left, in one plain line. */
export function allowanceLine(a: Allowance): string {
  const left = (x: { used: number; limit: number }) =>
    Math.max(0, x.limit - x.used);
  const plan = a.plan.charAt(0).toUpperCase() + a.plan.slice(1);
  return (
    `${plan} plan: ${left(a.daily)} of ${a.daily.limit} daily and ` +
    `${left(a.weekly)} of ${a.weekly.limit} weekly slots free. ` +
    `${plural(left(a.runsToday), "run")} left today.`
  );
}

let hosted: HostedData | null | undefined;

/** The app's one HostedData, or null in a build without hosted config. */
export function hostedData(): HostedData | null {
  if (hosted !== undefined) return hosted;
  const config = hostedConfig();
  const auth = hostedAuth();
  if (!config || !auth) return (hosted = null);
  hosted = createHostedData({
    supabaseUrl: config.url,
    anonKey: config.anonKey,
    workerUrl: (process.env.NEXT_PUBLIC_SCOUT_WORKER_URL ?? "").replace(
      /\/$/,
      "",
    ),
    session: async () => {
      const user = await auth.currentUser();
      const token = user ? await auth.accessToken() : null;
      return user && token ? { userId: user.id, accessToken: token } : null;
    },
  });
  return hosted;
}
