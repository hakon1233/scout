// Loopback client for the @scout/agent companion.
// The companion binds to 127.0.0.1:47821 by default; we try that first
// then fall back to a small known-port sweep so a user who started the
// agent on a different port can still pair.

import type { Brief as AppBrief } from "./types";
import { parseBrief } from "@scout/agent/brief-document";
import {
  PATHS,
  type Brief as WireBrief,
  type ScheduleView,
} from "@scout/agent/contract";
import { getLocalStorage, isClient, safeSetItem } from "./safe-storage";

// Dev/diagnostic trace for the browser→loopback transport. Every fetch
// helper below degrades to a falsy/empty fallback on failure so the UI stays
// usable — but that also made a genuine "my brief silently stopped updating"
// report undiagnosable from the console: the transport could go fully dark while
// the run-failure banner (run-failure.ts) had nothing to key off. This
// logs the *unexpected* data-fetch failures with a stable prefix. It never
// surfaces raw errors in the UI and never changes control flow (callers still get
// their existing fallback).
//
// Deliberately NOT wired into the two discovery probes (isServedFromCompanion,
// pingPort): a negative probe is the *expected* result of discovery — the
// marketing host has no /healthz and the loopback port sweep misses most ports
// on every run — so logging there would be noise that drowns the signal.
export function logCompanionError(context: string, err: unknown): void {
  console.error(`[companion] ${context} failed`, err);
}

export const COMPANION_PORT = 47821;
// Tried in order. Keep small — this only runs on the Connect page ping.
export const COMPANION_PORT_SWEEP = [47821, 47822, 47823, 47830, 47840];
const TOKEN_KEY = "scout.companion.token";

let cachedBase: string | null = null;

// In-flight coalescing for the cached-base re-ping, mirroring
// isServedFromCompanion's pattern below. fetchRunFailure's poll tick runs
// `Promise.all([pollBriefsRaw, fetchSchedule])`, and both independently call
// companionFetch() → discoverCompanion() in the same tick — without this, each
// fired its own /healthz ping against the identical cached port, doubling
// requests on every poll (10-30s, page.tsx). Sharing the in-flight promise
// collapses that pair to one ping without changing what gets verified.
let cachedBasePingInFlight: Promise<boolean> | null = null;

async function pingCachedBase(port: number): Promise<boolean> {
  if (cachedBasePingInFlight) return cachedBasePingInFlight;
  cachedBasePingInFlight = (async () => {
    try {
      return await pingPort(port);
    } finally {
      cachedBasePingInFlight = null;
    }
  })();
  return cachedBasePingInFlight;
}

function baseFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function loadCompanionToken(): string {
  const current = getLocalStorage()?.getItem(TOKEN_KEY);
  return current ?? "";
}

export function saveCompanionToken(token: string): void {
  // Via the shared write guard (safe-storage.ts): a token write that throws
  // (quota / Safari private mode) would otherwise abort the pairing handler
  // mid-flow. Pairing still works for this session; it just won't be remembered
  // across a reload.
  safeSetItem(TOKEN_KEY, token.trim());
}

// Memoized positive result of the same-origin probe below. Only `true` is
// cached: once we've confirmed the companion serves this origin it can't stop
// being the companion, but a transient miss (e.g. companion still booting)
// should be retried on the next call rather than latched off.
let servedFromCompanionConfirmed = false;

// In-flight coalescing for the same-origin probe. The /app mount
// fires several effects in the same tick that each call this (directly or via
// bootstrapCompanionToken / fetchCompanionInterests / discoverCompanion). Before
// the first /healthz resolves none of them is yet `confirmed`, so each would
// issue its own probe. Sharing the in-flight promise collapses that fan-out to a
// single request without changing the result.
let servedProbeInFlight: Promise<boolean> | null = null;

// True when the companion (or its TLS reverse proxy) is serving THIS page —
// i.e. a same-origin GET /healthz succeeds. This is host-agnostic on purpose:
// it is true for the loopback origin (http://127.0.0.1:47821/) AND for a
// proxy origin (https://<host>:<port>/) where something like `tailscale serve`
// proxies the same loopback companion. In all those cases the API is
// same-origin, so there is no public→loopback transition and the browser's
// Local Network Access / CORS prompt never fires.
//
// It is correctly false on the public marketing host (github.io), which serves
// /app/ but has no /healthz — there we fall back to the loopback port sweep.
//
// Not a hardcoded localhost/127.0.0.1 regex, which would exclude a proxy
// origin and break the token bootstrap and same-origin API there.
export async function isServedFromCompanion(): Promise<boolean> {
  if (!isClient()) return false;
  if (servedFromCompanionConfirmed) return true;
  if (servedProbeInFlight) return servedProbeInFlight;
  servedProbeInFlight = (async () => {
    try {
      const res = await fetch(`${window.location.origin}${PATHS.health}`, {
        signal: AbortSignal.timeout(1500),
      });
      servedFromCompanionConfirmed = res.ok;
      return res.ok;
    } catch {
      // Silent by design: a negative probe is the expected result on the
      // marketing host (no /healthz). See logCompanionError's note.
      return false;
    } finally {
      servedProbeInFlight = null;
    }
  })();
  return servedProbeInFlight;
}

// Companion config payload (GET /v0/config). Both the token bootstrap and the
// interests recovery read from the same endpoint.
type CompanionConfig = { token?: string | null; interests?: unknown };

// Coalesced read of GET /v0/config. The /app mount fires multiple
// effects that each need the companion config — bootstrapCompanionToken twice
// (poll + brief-adoption) and fetchCompanionInterests once or twice (adopt +
// reconcile). Each previously issued its own identical same-origin request on
// the primary paint path. A shared in-flight promise plus a short TTL collapses
// that burst to a single request, while the TTL is small enough that a config
// change (rare, user-driven) is still picked up on the next 10s poll tick.
let configInFlight: Promise<CompanionConfig | null> | null = null;
let configCache: CompanionConfig | null = null;
let configCachedAt = 0;
const CONFIG_TTL_MS = 3000;

async function fetchCompanionConfig(): Promise<CompanionConfig | null> {
  if (!isClient()) return null;
  if (configCache && Date.now() - configCachedAt < CONFIG_TTL_MS) {
    return configCache;
  }
  if (configInFlight) return configInFlight;
  configInFlight = (async () => {
    if (!(await isServedFromCompanion())) return null;
    try {
      const res = await fetch(`${window.location.origin}${PATHS.config}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const cfg = (await res.json()) as CompanionConfig;
      configCache = cfg;
      configCachedAt = Date.now();
      return cfg;
    } catch (err) {
      // Reached only after isServedFromCompanion() already confirmed a companion
      // serves this origin, so a failure here is unexpected, not routine.
      logCompanionError("config-fetch", err);
      return null;
    } finally {
      configInFlight = null;
    }
  })();
  return configInFlight;
}

// When served same-origin from the companion, fetch the pairing token from
// `/v0/config` and persist it — so the user never copy/pastes it. Returns the
// existing stored token when not served from the companion or if /v0/config is
// unreachable. Returns the active token, or "" if none.
export async function bootstrapCompanionToken(): Promise<string> {
  const existing = loadCompanionToken();
  const cfg = await fetchCompanionConfig();
  // Trim to match saveCompanionToken (which persists token.trim()). Comparing/
  // returning the raw cfg.token instead would, for a padded token, return a value
  // that differs from what's stored — a `Bearer abc ` header with trailing space
  // that can fail server-side auth — and re-save it on every bootstrap because the
  // trimmed store never equals the padded cfg value.
  const fromCfg = cfg?.token?.trim();
  if (fromCfg && fromCfg !== existing) {
    saveCompanionToken(fromCfg);
    return fromCfg;
  }
  return existing;
}

// Read the user's persisted interests from the companion when it's serving this
// page same-origin. The companion is the source of truth — it stores interests
// on every POST /v0/interests so its scheduler can run headless — so a browser
// without locally-saved settings (cleared storage, a different profile, or a
// different origin than the one that did first-run setup) can still recover the
// user's interests and render a usable brief instead of the setup form.
// Returns [] when not served same-origin or /v0/config is unreachable/empty.
export async function fetchCompanionInterests(): Promise<string[]> {
  const cfg = await fetchCompanionConfig();
  if (!cfg || !Array.isArray(cfg.interests)) return [];
  return cfg.interests.filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0,
  );
}

async function pingPort(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseFor(port)}${PATHS.health}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    // Silent by design: the loopback port sweep misses most ports on every run —
    // logging each would be noise, not signal.
    return false;
  }
}

// Returns the base URL of the live companion, or null. Caches the result
// so subsequent calls in the same session skip the sweep.
export async function discoverCompanion(): Promise<string | null> {
  // Served same-origin from the companion (loopback OR an HTTPS proxy)? Use this
  // exact origin — every API call is then same-origin (no CORS, no LNA prompt)
  // and we skip the loopback sweep. isServedFromCompanion() already confirmed it
  // via a same-origin /healthz probe, so no second fetch is needed here.
  if (await isServedFromCompanion()) {
    cachedBase = window.location.origin;
    return cachedBase;
  }
  if (cachedBase) {
    const cachedPort = new URL(cachedBase).port;
    if (
      await pingCachedBase(cachedPort ? Number(cachedPort) : COMPANION_PORT)
    ) {
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

export type CompanionRequest = {
  token?: string;
  method?: "GET" | "POST" | "PUT";
  // Sent as JSON.
  body?: unknown;
  // Defaults to 5s; a caller's `signal` replaces the timeout.
  timeoutMs?: number;
  signal?: AbortSignal;
};

// The one way to call the companion: finds it, then sends the request with the
// pairing token. Resolves with the raw response, so a caller can treat a
// refusal as "nothing" instead of an error. Throws when no companion answers.
export async function companionFetch(
  path: string,
  req: CompanionRequest = {},
): Promise<Response> {
  const base = await discoverCompanion();
  if (!base) {
    throw new Error(
      "Scout's companion isn't reachable. Start it with `scout-agent run` and try again.",
    );
  }
  const headers: Record<string, string> = {};
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  if (req.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${base}${path}`, {
    method: req.method ?? "GET",
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal ?? AbortSignal.timeout(req.timeoutMs ?? 5_000),
  });
}

// companionFetch for a JSON reply. A refusal throws an Error with the message
// set for its status, else the companion's hint or error, else
// "<failure> (<status>)."
export async function companionJson<T>(
  path: string,
  req: CompanionRequest & {
    failure: string;
    messages?: Partial<Record<number, string>>;
  },
): Promise<T> {
  const res = await companionFetch(path, req);
  if (!res.ok) {
    const fixed = req.messages?.[res.status];
    if (fixed) throw new Error(fixed);
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
    };
    throw new Error(
      body.hint ?? body.error ?? `${req.failure} (${res.status}).`,
    );
  }
  return (await res.json()) as T;
}

export async function postInterests(
  interests: string[],
  token: string,
  // Focused-retry: when set, the companion re-researches ONLY these
  // topics and merges them into the prior brief instead of regenerating it all.
  retryTopics?: string[],
): Promise<{ brief_id: string; status: string }> {
  const body: { interests: string[]; retry_topics?: string[] } = { interests };
  if (retryTopics && retryTopics.length > 0) body.retry_topics = retryTopics;
  return companionJson(PATHS.interests, {
    token,
    method: "POST",
    body,
    timeoutMs: 10_000,
    failure: "Couldn't start the run",
  });
}

// The brief arrives as markdown; the feed shows one article per citation.
// Exported so the mapping can be tested without a companion.
export function parseArticlesFromMarkdown(markdown: string, briefId: string) {
  const { topics, entries } = parseBrief(markdown);
  const articles: AppBrief["articles"] = [];
  for (const entry of entries) {
    const interest = entry.topic ?? "general";
    if (entry.kind === "citation") {
      articles.push({
        id: `${briefId}-${articles.length}`,
        title: entry.label.trim(),
        url: entry.url,
        interest,
      });
      continue;
    }
    for (const link of entry.links) {
      articles.push({
        id: `${briefId}-${articles.length}`,
        title: link.label.trim(),
        url: link.url,
        interest,
        publishedAt: entry.date ?? undefined,
        text: entry.summary || undefined,
        imageUrl: entry.image ?? undefined,
        body: entry.body ?? undefined,
      });
    }
  }
  return { articles, interests: topics };
}

function adaptBrief(b: WireBrief): AppBrief {
  const markdown = b.summary_md ?? "";
  const { articles, interests } = parseArticlesFromMarkdown(markdown, b.id);
  return {
    id: b.id,
    generatedAt: b.generated_at,
    ephemeral: b.ephemeral,
    kind: b.kind,
    interests,
    articles,
    markdown,
    topics: b.topics,
    bases: b.bases,
  };
}

// Shared by fetchLatestBrief and fetchRunFailure so both can derive the newest
// ready brief from an already-fetched raw list instead of each issuing their own
// /v0/briefs request. Kept cheap: pick the winner on the raw
// `generated_at` field first, then run adaptBrief (a full markdown regex parse)
// only on that one, not on every ready brief every poll tick.
//
// NOTE: the `?since=` list both callers pass only ever holds the
// single `last_brief` slot — briefs.ts filters `?since=` to that one slot, never
// the ready-brief history — so `raw` here is ≤1 element. On a failed/pending slot
// it therefore carries NO ready brief; fetchRunFailure falls back to
// fetchBriefHistory (via resolveLastSuccessBrief) for the true last success.
export function newestReadyBrief(raw: WireBrief[]): AppBrief | null {
  const ready = raw.filter((b) => b.status === "ready" && b.summary_md);
  if (ready.length === 0) return null;
  const newest = ready.reduce((newest, b) =>
    b.generated_at > newest.generated_at ? b : newest,
  );
  return adaptBrief(newest);
}

// Fetch the most recent ready brief the companion holds (any age), or null if
// none exist / the companion is unreachable. Used on `/app/` load so a brief
// generated in a previous session shows immediately instead of the example.
export async function fetchLatestBrief(
  token: string,
): Promise<AppBrief | null> {
  try {
    const raw = await pollBriefsRaw(new Date(0).toISOString(), token);
    return await resolveLastSuccessBrief(newestReadyBrief(raw), () =>
      fetchBriefHistory(token, { limit: 1, offset: 0 }).then(
        (history) => history.briefs[0] ?? null,
      ),
    );
  } catch (err) {
    logCompanionError("latest-brief-fetch", err);
    return null;
  }
}

// Resolve the "last successful brief" for the run-failure banner's
// "Showing your last good brief from <date>" clause. `pollBriefsRaw(?since=)`
// returns only the single `last_brief` slot, so on a failed/pending run
// `slotReady` is null even though ready briefs still exist in history. In that
// (uncommon, unhealthy) case only, fall back to one page of ready-brief history.
// `fetchHistoryNewest` is invoked lazily so the healthy path — slot already
// ready — stays a single request and doesn't undo the poll-dedup.
export async function resolveLastSuccessBrief(
  slotReady: AppBrief | null,
  fetchHistoryNewest: () => Promise<AppBrief | null>,
): Promise<AppBrief | null> {
  // Ephemeral test runs intentionally occupy last_brief so their
  // initiator can poll the result, but they are not feed editions. Real history
  // already excludes them at the runner, making it the safe fallback.
  if (slotReady && !slotReady.ephemeral) return slotReady;
  return await fetchHistoryNewest();
}

// Read the persisted schedule config + run telemetry. Throws on an unreachable
// companion or non-2xx so the caller can render a real error / "not paired" state.
export async function fetchSchedule(token: string): Promise<ScheduleView> {
  return companionJson(PATHS.schedule, {
    token,
    failure: "Couldn't read the schedule",
  });
}

// Write the schedule (enable/disable and/or time-of-day). The companion
// validates, re-arms its live timer, and echoes back the updated view —
// including the recomputed next_run_at — so the caller renders truth, not a
// guess. Throws the companion's human-readable error on 400/401/etc.
export async function updateSchedule(
  patch: { enabled?: boolean; time_of_day?: string },
  token: string,
): Promise<ScheduleView> {
  return companionJson(PATHS.schedule, {
    token,
    method: "PUT",
    body: patch,
    timeoutMs: 8_000,
    failure: "Couldn't save the schedule",
  });
}

// Page the companion's rolling brief history, newest-first. Backs the
// feed's "previous briefs" pager: the current brief is shown at the top of the
// page, so the pager starts at offset 1 to skip it. Returns the adapted (parsed)
// ready briefs in this page plus the server's total ready-brief count so the
// caller knows whether a "Load older briefs" button is still warranted.
//
// Uses the limit/offset form of GET /v0/briefs (distinct from the no-param
// single-slot poller contract `pollBriefsRaw` relies on). Filters to ready
// briefs with summary markdown — a half-written/failed brief never renders as a
// past edition. Returns an empty page (and total 0) on any error so the feed
// degrades to "no older briefs" rather than throwing.
export async function fetchBriefHistory(
  token: string,
  opts: { limit: number; offset: number },
): Promise<{ briefs: AppBrief[]; total: number }> {
  try {
    const res = await companionFetch(
      `${PATHS.briefs}?limit=${opts.limit}&offset=${opts.offset}`,
      { token },
    );
    if (!res.ok) return { briefs: [], total: 0 };
    const json = (await res.json()) as {
      briefs: WireBrief[];
      total?: number;
    };
    const briefs = (json.briefs ?? [])
      .filter((b) => b.status === "ready" && b.summary_md)
      .map(adaptBrief);
    return { briefs, total: json.total ?? briefs.length };
  } catch (err) {
    logCompanionError("brief-history-fetch", err);
    return { briefs: [], total: 0 };
  }
}

export async function pollBriefsRaw(
  sinceTs: string,
  token: string,
): Promise<WireBrief[]> {
  const res = await companionFetch(
    `${PATHS.briefs}?since=${encodeURIComponent(sinceTs)}`,
    { token },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { briefs?: WireBrief[] };
  // Trust-boundary guard: a malformed/empty `{}` body (no `briefs`) must not
  // hand callers `undefined` — every caller immediately `.filter`/`.reduce`s the
  // result, so a missing field would throw a TypeError surfaced as a confusing
  // generic error instead of a clean "no briefs". Mirrors the `?? []` fallback
  // already in `fetchBriefsPage`.
  return json.briefs ?? [];
}

// Each research session may run 4 minutes (research.ts), but on a busy machine
// a real six-topic run took 32m40s; 6 minutes per topic leaves headroom.
const PER_TOPIC_SESSION_BUDGET_MS = 6 * 60 * 1000;

// Kick a synthesis pass on the companion and poll until a fresh brief
// (newer than `sinceTs`) lands or `timeoutMs` elapses. Throws on failure.
export async function refreshBriefViaCompanion(
  interests: string[],
  token: string,
  opts: {
    sinceTs?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    // Focused-retry: re-research only these topics, merge into the
    // prior brief. Must be a subset of `interests`.
    retryTopics?: string[];
    // Called once the companion accepts the run, with how long we will wait.
    onStarted?: (waitMs: number) => void;
  } = {},
): Promise<AppBrief> {
  const since = opts.sinceTs ?? new Date(0).toISOString();
  // The companion researches one topic at a time, and a real six-topic run
  // has taken over 30 minutes. Wait PER_TOPIC_SESSION_BUDGET_MS per researched
  // topic plus one for assembly, and at least 5 minutes.
  const researchedTopicCount =
    opts.retryTopics && opts.retryTopics.length > 0
      ? opts.retryTopics.length
      : interests.length;
  const scaledDeadlineMs = Math.max(
    300_000,
    (researchedTopicCount + 1) * PER_TOPIC_SESSION_BUDGET_MS,
  );
  const waitMs = opts.timeoutMs ?? scaledDeadlineMs;
  const deadline = Date.now() + waitMs;
  await postInterests(interests, token, opts.retryTopics);
  opts.onStarted?.(waitMs);
  let pollErrorLogged = false;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, 2000));
    let briefs: WireBrief[];
    try {
      briefs = await pollBriefsRaw(since, token);
    } catch (err) {
      // Keep waiting through a dropped poll; log the first so a companion that
      // stays dark is visible in the console before the deadline.
      if (!pollErrorLogged) logCompanionError("brief-poll", err);
      pollErrorLogged = true;
      continue;
    }
    const latest = briefs[0];
    if (!latest) continue;
    if (latest.status === "ready" && latest.summary_md)
      return adaptBrief(latest);
    if (latest.status === "failed")
      throw new Error(latest.error_msg ?? "synthesis failed");
  }
  throw new Error("Timed out waiting for the companion brief.");
}

// Build a weekly digest from the companion's retained ready daily briefs. This
// never writes interests or kicks a live research/model run; it re-ranks the
// existing local history into one top-stories edition.
export async function generateWeeklyBrief(token: string): Promise<AppBrief> {
  const json = await companionJson<{ brief?: WireBrief }>(PATHS.weeklyBrief, {
    token,
    method: "POST",
    timeoutMs: 10_000,
    failure: "Couldn't generate weekly brief",
  });
  // Trust-boundary guard (mirrors the pollBriefsRaw guard): a 2xx with a
  // malformed/empty `{}` body (no `brief`) must not reach adaptBrief, which
  // immediately dereferences `.summary_md`/`.id` and would throw a raw
  // "Cannot read properties of undefined" TypeError — surfaced to the user as a
  // confusing generic error. Surface the same clean failure as the `!res.ok`
  // path above instead.
  if (!json.brief) {
    throw new Error("Couldn't generate weekly brief (malformed response).");
  }
  return adaptBrief(json.brief);
}
