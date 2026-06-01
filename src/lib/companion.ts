// Loopback client for the @scout/agent companion.
// The companion binds to 127.0.0.1:47821 by default; we try that first
// then fall back to a small known-port sweep so a user who started the
// agent on a different port can still pair.

import type { Brief as AppBrief } from "./types";

export const COMPANION_PORT = 47821;
// Tried in order. Keep small — this only runs on the Connect page ping.
export const COMPANION_PORT_SWEEP = [47821, 47822, 47823, 47830, 47840];
const TOKEN_KEY = "scout.companion.token";

let cachedBase: string | null = null;

function baseFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function loadCompanionToken(): string {
  if (typeof window === "undefined") return "";
  const current = window.localStorage.getItem(TOKEN_KEY);
  return current ?? "";
}

export function saveCompanionToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token.trim());
}

// Memoized positive result of the same-origin probe below. Only `true` is
// cached: once we've confirmed the companion serves this origin it can't stop
// being the companion, but a transient miss (e.g. companion still booting)
// should be retried on the next call rather than latched off.
let servedFromCompanionConfirmed = false;

// True when the companion (or its TLS reverse proxy) is serving THIS page —
// i.e. a same-origin GET /healthz succeeds. This is host-agnostic on purpose:
// it is true for the loopback origin (http://127.0.0.1:47821/) AND for a
// Tailscale origin (https://<host>.ts.net:<port>/) where `tailscale serve`
// proxies the same loopback companion. In all those cases the API is
// same-origin, so there is no public→loopback transition and the browser's
// Local Network Access / CORS prompt never fires.
//
// It is correctly false on the public marketing host (github.io), which serves
// /app/ but has no /healthz — there we fall back to the loopback port sweep.
//
// PER-124: previously a hardcoded localhost/127.0.0.1 regex, which excluded
// *.ts.net and broke token bootstrap + same-origin API on the Tailscale origin.
export async function isServedFromCompanion(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (servedFromCompanionConfirmed) return true;
  try {
    const res = await fetch(`${window.location.origin}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    servedFromCompanionConfirmed = res.ok;
    return servedFromCompanionConfirmed;
  } catch {
    return false;
  }
}

// When served same-origin from the companion, fetch the pairing token from
// `/v0/config` and persist it — so the user never copy/pastes it. Returns the
// existing stored token when not served from the companion or if /v0/config is
// unreachable. Returns the active token, or "" if none.
export async function bootstrapCompanionToken(): Promise<string> {
  const existing = loadCompanionToken();
  if (!(await isServedFromCompanion())) return existing;
  try {
    const res = await fetch(`${window.location.origin}/v0/config`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return existing;
    const cfg = (await res.json()) as { token?: string | null };
    if (cfg.token && cfg.token !== existing) {
      saveCompanionToken(cfg.token);
      return cfg.token;
    }
  } catch {
    // not reachable / not same-origin — fall back to the stored token
  }
  return existing;
}

async function pingPort(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseFor(port)}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Returns the base URL of the live companion, or null. Caches the result
// so subsequent calls in the same session skip the sweep.
export async function discoverCompanion(): Promise<string | null> {
  // Served same-origin from the companion (loopback OR a ts.net proxy)? Use this
  // exact origin — every API call is then same-origin (no CORS, no LNA prompt)
  // and we skip the loopback sweep. isServedFromCompanion() already confirmed it
  // via a same-origin /healthz probe, so no second fetch is needed here.
  if (await isServedFromCompanion()) {
    cachedBase = window.location.origin;
    return cachedBase;
  }
  if (cachedBase) {
    if (await pingPort(new URL(cachedBase).port ? Number(new URL(cachedBase).port) : COMPANION_PORT)) {
      return cachedBase;
    }
    cachedBase = null;
  }
  for (const port of COMPANION_PORT_SWEEP) {
    if (await pingPort(port)) {
      cachedBase = baseFor(port);
      return cachedBase;
    }
  }
  return null;
}

export async function pingCompanion(): Promise<boolean> {
  return (await discoverCompanion()) !== null;
}

async function requireBase(): Promise<string> {
  const base = await discoverCompanion();
  if (!base) throw new Error("Companion not reachable. Start `scout-agent run` and try again.");
  return base;
}

export async function postInterests(
  interests: string[],
  token: string,
): Promise<{ brief_id: string; status: string }> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/interests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ interests }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error: string;
      hint?: string;
    };
    throw new Error(err.hint ?? err.error);
  }
  return res.json() as Promise<{ brief_id: string; status: string }>;
}

type AgentBrief = {
  id: string;
  generated_at: string;
  status: string;
  summary_md?: string;
  error_msg?: string;
};

// The companion no longer returns a structured `articles` list — the model
// emits the brief markdown directly, with citations inline as `[domain — Title](url)`.
// We parse those out so the rest of the UI (Sources panel, interest chips) keeps
// working without changing its data shape.
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const TOPIC_HEADING_RE = /^##\s+(.+?)\s*$/;

function parseArticlesFromMarkdown(markdown: string, briefId: string) {
  const articles: AppBrief["articles"] = [];
  const interests = new Set<string>();
  let currentTopic = "general";
  let idx = 0;

  for (const line of markdown.split("\n")) {
    const heading = TOPIC_HEADING_RE.exec(line);
    if (heading) {
      currentTopic = heading[1].trim();
      interests.add(currentTopic);
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(line)) !== null) {
      const [, label, url] = m;
      articles.push({
        id: `${briefId}-${idx++}`,
        title: label.trim(),
        url,
        interest: currentTopic,
      });
    }
  }
  return { articles, interests: [...interests] };
}

function adaptBrief(b: AgentBrief): AppBrief {
  const markdown = b.summary_md ?? "";
  const { articles, interests } = parseArticlesFromMarkdown(markdown, b.id);
  return {
    id: b.id,
    generatedAt: b.generated_at,
    interests,
    articles,
    markdown,
  };
}

// Returns ready briefs strictly newer than `sinceTs`. Pending/failed are surfaced
// via `pollBriefsRaw` for the polling loop.
export async function pollBriefs(sinceTs: string, token: string): Promise<AppBrief[]> {
  const briefs = await pollBriefsRaw(sinceTs, token);
  return briefs.filter((b) => b.status === "ready" && b.summary_md).map(adaptBrief);
}

// Fetch the most recent ready brief the companion holds (any age), or null if
// none exist / the companion is unreachable. Used on `/app/` load so a brief
// generated in a previous session shows immediately instead of the example.
export async function fetchLatestBrief(token: string): Promise<AppBrief | null> {
  try {
    const briefs = await pollBriefs(new Date(0).toISOString(), token);
    if (briefs.length === 0) return null;
    return briefs.reduce((newest, b) =>
      b.generatedAt > newest.generatedAt ? b : newest,
    );
  } catch {
    return null;
  }
}

// Recurring-schedule config + last/next-run telemetry the companion exposes at
// GET|PUT /v0/schedule (PER-151). The Settings UI (PER-152) reads this to render
// the schedule controls and the legibility row. `reboot_durable` is false for
// the nohup `run` companion — the timer dies with the process.
export type CompanionSchedule = {
  enabled: boolean;
  /** "HH:MM" 24h local time-of-day the scheduled run fires. */
  time_of_day: string;
  last_run_at: string | null;
  last_run_status: "success" | "failed" | "skipped" | null;
  last_run_note: string | null;
  next_run_at: string | null;
  reboot_durable: boolean;
};

// Read the persisted schedule config + run telemetry. Throws on an unreachable
// companion or non-2xx so the caller can render a real error / "not paired" state.
export async function fetchSchedule(token: string): Promise<CompanionSchedule> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/schedule`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Couldn't read the schedule (${res.status}).`);
  }
  return res.json() as Promise<CompanionSchedule>;
}

// Write the schedule (enable/disable and/or time-of-day). The companion
// validates, re-arms its live timer, and echoes back the updated view —
// including the recomputed next_run_at — so the caller renders truth, not a
// guess. Throws the companion's human-readable error on 400/401/etc.
export async function updateSchedule(
  patch: { enabled?: boolean; time_of_day?: string },
  token: string,
): Promise<CompanionSchedule> {
  const base = await requireBase();
  const res = await fetch(`${base}/v0/schedule`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Couldn't save the schedule (${res.status}).`);
  }
  return res.json() as Promise<CompanionSchedule>;
}

export async function pollBriefsRaw(sinceTs: string, token: string): Promise<AgentBrief[]> {
  const base = await requireBase();
  const url = `${base}/v0/briefs?since=${encodeURIComponent(sinceTs)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { briefs: AgentBrief[] };
  return json.briefs;
}

// Kick a synthesis pass on the companion and poll until a fresh brief
// (newer than `sinceTs`) lands or `timeoutMs` elapses. Throws on failure.
export async function refreshBriefViaCompanion(
  interests: string[],
  token: string,
  opts: { sinceTs?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AppBrief> {
  const since = opts.sinceTs ?? new Date(0).toISOString();
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  await postInterests(interests, token);
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, 2000));
    const briefs = await pollBriefsRaw(since, token);
    const latest = briefs[0];
    if (!latest) continue;
    if (latest.status === "ready" && latest.summary_md) return adaptBrief(latest);
    if (latest.status === "failed") throw new Error(latest.error_msg ?? "synthesis failed");
  }
  throw new Error("Timed out waiting for the companion brief.");
}
