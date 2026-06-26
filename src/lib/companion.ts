// Loopback client for the @scout/agent companion.
// The companion binds to 127.0.0.1:47821 by default; we try that first
// then fall back to a small known-port sweep so a user who started the
// agent on a different port can still pair.

import type { Brief as AppBrief, TopicBasis, TopicCoverage } from "./types";
import { readErrorBody } from "./errors";
import { safeSetItem } from "./safe-storage";

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

// In-flight coalescing for the same-origin probe (AIR-204). The /app mount
// fires several effects in the same tick that each call this (directly or via
// bootstrapCompanionToken / fetchCompanionInterests / discoverCompanion). Before
// the first /healthz resolves none of them is yet `confirmed`, so each would
// issue its own probe. Sharing the in-flight promise collapses that fan-out to a
// single request without changing the result.
let servedProbeInFlight: Promise<boolean> | null = null;

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
  if (servedProbeInFlight) return servedProbeInFlight;
  servedProbeInFlight = (async () => {
    try {
      const res = await fetch(`${window.location.origin}/healthz`, {
        signal: AbortSignal.timeout(1500),
      });
      servedFromCompanionConfirmed = res.ok;
      return res.ok;
    } catch {
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

// Coalesced read of GET /v0/config (AIR-204). The /app mount fires multiple
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
  if (typeof window === "undefined") return null;
  if (configCache && Date.now() - configCachedAt < CONFIG_TTL_MS) {
    return configCache;
  }
  if (configInFlight) return configInFlight;
  configInFlight = (async () => {
    if (!(await isServedFromCompanion())) return null;
    try {
      const res = await fetch(`${window.location.origin}/v0/config`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const cfg = (await res.json()) as CompanionConfig;
      configCache = cfg;
      configCachedAt = Date.now();
      return cfg;
    } catch {
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
  if (cfg?.token && cfg.token !== existing) {
    saveCompanionToken(cfg.token);
    return cfg.token;
  }
  return existing;
}

// Read the user's persisted interests from the companion when it's serving this
// page same-origin. The companion is the source of truth — it stores interests
// on every POST /v0/interests so its scheduler can run headless — so a browser
// without locally-saved settings (cleared storage, a different profile, or a
// different origin than the one that did first-run setup) can still recover the
// user's interests and render a usable brief instead of the setup form (PER-157).
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
    if (
      await pingPort(
        new URL(cachedBase).port
          ? Number(new URL(cachedBase).port)
          : COMPANION_PORT,
      )
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

async function requireBase(): Promise<string> {
  const base = await discoverCompanion();
  if (!base)
    throw new Error(
      "Companion not reachable. Start `scout-agent run` and try again.",
    );
  return base;
}

export async function postInterests(
  interests: string[],
  token: string,
  // Focused-retry (PER-154): when set, the companion re-researches ONLY these
  // topics and merges them into the prior brief instead of regenerating it all.
  retryTopics?: string[],
  // Run-selector (C6/PER-173): when set, research ONLY this subset and produce a
  // fresh brief over just those topics. `interests` still carries the FULL list
  // so the companion's saved set (the scheduler's source of truth) is unchanged.
  selectedTopics?: string[],
): Promise<{ brief_id: string; status: string }> {
  const base = await requireBase();
  const body: {
    interests: string[];
    retry_topics?: string[];
    selected_topics?: string[];
  } = { interests };
  if (retryTopics && retryTopics.length > 0) body.retry_topics = retryTopics;
  if (selectedTopics && selectedTopics.length > 0)
    body.selected_topics = selectedTopics;
  const res = await fetch(`${base}/v0/interests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(err.hint ?? err.error);
  }
  return res.json() as Promise<{ brief_id: string; status: string }>;
}

// Persist the user's interests to the companion (state.json) WITHOUT kicking a
// synthesis run — the "save my profile" action (PER-160). Distinct from
// `postInterests`, which also runs a ~5-min brief. Best-effort: callers use this
// so a profile edit sticks server-side (and survives for the headless scheduler)
// even if the user doesn't immediately Run now. Throws the companion's
// human-readable error on non-2xx so the caller can surface it.
export async function saveInterests(
  interests: string[],
  token: string,
  // Wipe-guard token (PER-240): the companion's PUT is replace-all and 409s any
  // payload that would drop a currently-saved interest. A caller making a
  // deliberate, user-confirmed removal must pass true; additive saves never
  // need it.
  confirmReplace?: boolean,
): Promise<{ interests: string[]; status: string }> {
  const base = await requireBase();
  const body: { interests: string[]; confirm_replace?: boolean } = {
    interests,
  };
  if (confirmReplace) body.confirm_replace = true;
  const res = await fetch(`${base}/v0/interests`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(
      err.hint ?? err.error ?? `Couldn't save interests (${res.status}).`,
    );
  }
  return res.json() as Promise<{ interests: string[]; status: string }>;
}

type AgentBrief = {
  id: string;
  generated_at: string;
  status: string;
  kind?: "daily" | "weekly";
  summary_md?: string;
  error_msg?: string;
  // Authoritative per-topic coverage (PER-154); present on briefs from a
  // companion >= 0.3.x. Absent on older cached briefs — the UI then falls back
  // to deriving status from the parsed headings.
  topics?: TopicCoverage[];
  // Per-topic snapshot of the intent doc that drove each section's research
  // (PER-187). Present on briefs from a companion that supports it; absent on
  // older cached briefs.
  bases?: TopicBasis[];
};

// The companion no longer returns a structured `articles` list — the model
// emits the brief markdown directly, with citations inline as `[domain — Title](url)`.
// We parse those out so the rest of the UI (Sources panel, interest chips) keeps
// working without changing its data shape.
// URL body inside a markdown `(...)` link/image. Tolerates ONE level of balanced
// parens inside the URL so filenames like `...AI%20(13).png` — common on Webflow/
// CDN hosts — are not truncated at the first `)` (PER-216). A bare `)` ends the
// group, so it's still the closing markdown paren that terminates the match.
const MD_URL = "https?:\\/\\/(?:[^()\\s]|\\([^()\\s]*\\))+";
const LINK_RE = new RegExp(`\\[([^\\]]+)\\]\\((${MD_URL})\\)`, "g");
// Markdown image: `![alt](url)`. Captured into Article.imageUrl (PER-211). Run
// BEFORE/alongside LINK_RE; LINK_RE deliberately skips `!`-prefixed matches so an
// image's `[alt](url)` tail is never collected as a citation.
const IMAGE_RE = new RegExp(`!\\[[^\\]]*\\]\\((${MD_URL})\\)`, "g");
const TOPIC_HEADING_RE = /^##\s+(.+?)\s*$/;
const STORY_BULLET_RE = /^\s*[-*]\s+/;
// In-depth body line: an indented markdown blockquote under the story's
// citation/image (PER-214). `> text` → a body paragraph line; a bare `>` is a
// paragraph break. We collect these into Article.body for the click-through
// detail view. Captured value excludes the `> ` marker.
const STORY_BODY_RE = /^\s*>\s?(.*)$/;
// Per-story publish date: each story bullet may lead with its date as an ISO date
// (or `undated`) in backticks — the contract set by the shared search-skills
// fragment (packages/agent/src/search-skills.ts STORY_DATE_RE). We capture it
// into Article.publishedAt so the UI can show it per item and sort newest-first.
// (The sample brief uses dateless bullets, so a leading date is not required.)
const STORY_DATE_RE =
  /^\s*[-*]\s+`(\d{4}-\d{2}-\d{2}|undated)`\s*(?:—|–|-)?\s*/;

// Balanced-paren tolerance (PER-216) so a `(13)` in a CDN filename doesn't leave
// a stray `).png)` tail in the card blurb. Kept scheme-agnostic (unlike
// LINK_RE/IMAGE_RE) to match the original strip breadth. The `inner` pattern is
// invariant, so these are compiled once at module load instead of on every
// stripInlineMarkdown call — which runs per story bullet, per brief, and per
// poll tick. Reuse with String#replace is safe: replace resets a global regex's
// lastIndex on each call.
const STRIP_INNER = "(?:[^()]|\\([^()]*\\))*";
const STRIP_IMAGE_RE = new RegExp(`!\\[[^\\]]*\\]\\(${STRIP_INNER}\\)`, "g");
const STRIP_LINK_RE = new RegExp(`\\[([^\\]]+)\\]\\(${STRIP_INNER}\\)`, "g");

// Reduce inline markdown to plain text for the card blurb: drop images entirely,
// unwrap links to their label, collapse leftover emphasis markers.
function stripInlineMarkdown(s: string): string {
  return s
    .replace(STRIP_IMAGE_RE, "")
    .replace(STRIP_LINK_RE, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A story accumulates its lines (bullet + continuation citation/image lines)
// before being flushed into articles, because the source-image line follows the
// citation line — so the image URL isn't known yet when the citation is seen.
type PendingStory = {
  topic: string;
  date?: string;
  blurb: string;
  links: Array<{ label: string; url: string }>;
  image?: string;
  // Raw blockquote body lines (marker stripped). A bare `>` line lands here as
  // "" and becomes a paragraph break when joined. Flushed into Article.body.
  bodyLines: string[];
};

function parseArticlesFromMarkdown(markdown: string, briefId: string) {
  const articles: AppBrief["articles"] = [];
  const interests = new Set<string>();
  let currentTopic = "general";
  let idx = 0;
  let story: PendingStory | null = null;

  const flush = () => {
    if (!story) return;
    // Join blockquote lines into paragraphs: bare `>` lines (captured as "")
    // become blank lines, so trimming + collapsing 3+ newlines yields clean
    // `\n\n`-separated paragraphs the detail view can split on.
    const body =
      story.bodyLines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() || undefined;
    for (const link of story.links) {
      articles.push({
        id: `${briefId}-${idx++}`,
        title: link.label.trim(),
        url: link.url,
        interest: story.topic,
        publishedAt: story.date,
        text: story.blurb || undefined,
        imageUrl: story.image,
        body,
      });
    }
    story = null;
  };

  const collectImages = (line: string) => {
    let im: RegExpExecArray | null;
    IMAGE_RE.lastIndex = 0;
    while ((im = IMAGE_RE.exec(line)) !== null) {
      if (story && !story.image) story.image = im[1];
    }
  };

  const collectLinks = (line: string) => {
    let m: RegExpExecArray | null;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(line)) !== null) {
      // Skip image markdown: `![alt](url)` — the `[alt](url)` tail matches LINK_RE
      // but is preceded by `!`. Those are handled by collectImages, not citations.
      if (m.index > 0 && line[m.index - 1] === "!") continue;
      const [, label, url] = m;
      if (story) {
        story.links.push({ label, url });
      } else {
        // A citation outside any story bullet (e.g. inline in prose). Preserve the
        // prior behavior of surfacing it as a standalone, dateless article.
        articles.push({
          id: `${briefId}-${idx++}`,
          title: label.trim(),
          url,
          interest: currentTopic,
        });
      }
    }
  };

  for (const line of markdown.split("\n")) {
    const heading = TOPIC_HEADING_RE.exec(line);
    if (heading) {
      flush();
      currentTopic = heading[1].trim();
      interests.add(currentTopic);
      continue;
    }
    if (STORY_BULLET_RE.test(line)) {
      flush();
      const dateMatch = STORY_DATE_RE.exec(line);
      const date =
        dateMatch && dateMatch[1] !== "undated" ? dateMatch[1] : undefined;
      // Blurb = bullet text minus the marker and the leading `date` — token.
      const blurb = stripInlineMarkdown(
        dateMatch
          ? line.slice(dateMatch[0].length)
          : line.replace(STORY_BULLET_RE, ""),
      );
      story = {
        topic: currentTopic,
        date,
        blurb,
        links: [],
        image: undefined,
        bodyLines: [],
      };
    }
    // In-depth body blockquote (`> …`): pure prose — collect it and DON'T run the
    // link/image scanners on it, so a stray markdown link inside the body never
    // pollutes the citation/source list (PER-214).
    const bodyMatch = STORY_BODY_RE.exec(line);
    if (bodyMatch && story) {
      story.bodyLines.push(bodyMatch[1]);
      continue;
    }
    // Image first so its URL is parked on the story; then citations (which skip
    // the `!`-prefixed image match). Order within a line doesn't matter here.
    collectImages(line);
    collectLinks(line);
  }
  flush();
  return { articles, interests: [...interests] };
}

function adaptBrief(b: AgentBrief): AppBrief {
  const markdown = b.summary_md ?? "";
  const { articles, interests } = parseArticlesFromMarkdown(markdown, b.id);
  return {
    id: b.id,
    generatedAt: b.generated_at,
    kind: b.kind,
    interests,
    articles,
    markdown,
    topics: b.topics,
    bases: b.bases,
  };
}

// Returns ready briefs strictly newer than `sinceTs`. Pending/failed are surfaced
// via `pollBriefsRaw` for the polling loop.
export async function pollBriefs(
  sinceTs: string,
  token: string,
): Promise<AppBrief[]> {
  const briefs = await pollBriefsRaw(sinceTs, token);
  return briefs
    .filter((b) => b.status === "ready" && b.summary_md)
    .map(adaptBrief);
}

// Fetch the most recent ready brief the companion holds (any age), or null if
// none exist / the companion is unreachable. Used on `/app/` load so a brief
// generated in a previous session shows immediately instead of the example.
export async function fetchLatestBrief(
  token: string,
): Promise<AppBrief | null> {
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
    const err = await readErrorBody(res);
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
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(err.error ?? `Couldn't save the schedule (${res.status}).`);
  }
  return res.json() as Promise<CompanionSchedule>;
}

// Page the companion's rolling brief history, newest-first (PER-219). Backs the
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
    const base = await requireBase();
    const url = `${base}/v0/briefs?limit=${opts.limit}&offset=${opts.offset}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { briefs: [], total: 0 };
    const json = (await res.json()) as {
      briefs: AgentBrief[];
      total?: number;
    };
    const briefs = (json.briefs ?? [])
      .filter((b) => b.status === "ready" && b.summary_md)
      .map(adaptBrief);
    return { briefs, total: json.total ?? briefs.length };
  } catch {
    return { briefs: [], total: 0 };
  }
}

export async function pollBriefsRaw(
  sinceTs: string,
  token: string,
): Promise<AgentBrief[]> {
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
  opts: {
    sinceTs?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    // Focused-retry (PER-154): re-research only these topics, merge into the
    // prior brief. Must be a subset of `interests`.
    retryTopics?: string[];
    // Run-selector (C6/PER-173): research only this subset and produce a fresh
    // brief over just those topics. Must be a subset of `interests`.
    selectedTopics?: string[];
  } = {},
): Promise<AppBrief> {
  const since = opts.sinceTs ?? new Date(0).toISOString();
  // A real run researches every interest with live WebSearch + WebFetch, so a
  // full 6-topic pass routinely runs past two minutes — especially cold or when
  // `claude` is rate-limited. A 120s client deadline gave up while the companion
  // kept working: the UI showed "Timed out…", and because the server run was
  // still in flight, the user's next click hit the single-flight 409 and errored
  // again — the "it doesn't work" go-around (PER-157). Give the run real room.
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  await postInterests(interests, token, opts.retryTopics, opts.selectedTopics);
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, 2000));
    const briefs = await pollBriefsRaw(since, token);
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
  const base = await requireBase();
  const res = await fetch(`${base}/v0/weekly-brief`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new Error(
      err.error ?? `Couldn't generate weekly brief (${res.status}).`,
    );
  }
  const json = (await res.json()) as { brief: AgentBrief };
  return adaptBrief(json.brief);
}
