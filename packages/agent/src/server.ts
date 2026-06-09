// Loopback HTTP server. Binds to 127.0.0.1 only; never exposed to LAN.
//
// Endpoints:
//   GET  /healthz                — liveness, no auth
//   POST /v0/interests           — kick a synthesis pass (auth)
//   GET  /v0/briefs?since=<iso>  — list briefs generated since <iso> (auth)
//
// Auth is a bearer token (the pairing token) on the Authorization header.
// The web app reads the same token from local storage after the user pastes
// it into the Connect page.
//
// State contract: the companion retains exactly one brief at a time
// (`state.last_brief`, "last writer wins"). To keep that slot deterministic,
// POST /v0/interests returns 409 while `last_brief.status === "pending"` —
// callers must wait for the in-flight synth to land before kicking a new one.

import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import {
  loadState,
  normalizeTimeOfDay,
  saveState,
  defaultSchedule,
  reconcileInterests,
  interestTopics,
  STATE_FILE,
  type Brief,
  type ChatTurn,
  type ScheduleConfig,
  type State,
} from "./state.js";
import { interestDocMeta, readInterestDoc } from "./docs.js";
import { startRun } from "./runner.js";
import {
  confirmDeleteTurn,
  defaultChatTranscriptFile,
  readChatTranscript,
  startChatTurn,
} from "./chat.js";
import { isServiceInstalled } from "./service.js";
import {
  resolveStatic,
  resolveAppShellFallback,
  trailingSlashRedirect,
} from "./static.js";

export const PKG_VERSION = "0.3.0";
export const DEFAULT_PORT = Number(process.env.SCOUT_AGENT_PORT ?? 47821);

export type ServerDeps = {
  stateFile?: string;
  claudeBin?: string;
  // Injected for tests; production uses node:child_process spawn.
  spawnFn?: typeof spawn;
  // The synth pass is async; tests can wait on this to know when it finishes.
  onSynthesisDone?: (brief: Brief) => void;
  // Static UI root; defaults to the bundled webroot. Injected for tests.
  webroot?: string;
  // Invoked after PUT /v0/schedule persists a config change, so the running
  // scheduler can re-arm its timer immediately (PER-151). No-op when absent.
  onScheduleChanged?: () => void | Promise<void>;
  // Per-interest intent-doc directory; defaults to `interests/` beside the state
  // file (in production CONFIG_DIR/interests === docs.ts INTERESTS_DIR). Injected
  // for tests so GET /v0/interests and the synthesis doc-backfill run against a
  // hermetic doc store instead of the real home dir.
  interestsDir?: string;
  // The chat turn is async (kick + poll like briefs); tests wait on this to know
  // when a turn has finished applying its changes. (PER-172)
  onChatDone?: (turn: ChatTurn) => void;
};

// Shape GET /v0/schedule returns and PUT echoes back — the contract the
// Settings UI (PER-152) consumes. `reboot_durable` is true once a launchd
// LaunchAgent (PER-153) is installed: launchd then restarts the companion at
// login/boot, so the scheduler survives a reboot. When false the UI warns the
// founder to re-run `scout-agent run` after a reboot.
export type ScheduleView = {
  enabled: boolean;
  time_of_day: string;
  last_run_at: string | null;
  last_run_status: ScheduleConfig["last_run_status"] | null;
  last_run_note: string | null;
  next_run_at: string | null;
  reboot_durable: boolean;
};

function scheduleView(cfg: ScheduleConfig): ScheduleView {
  return {
    enabled: cfg.enabled,
    time_of_day: cfg.time_of_day,
    last_run_at: cfg.last_run_at ?? null,
    last_run_status: cfg.last_run_status ?? null,
    last_run_note: cfg.last_run_note ?? null,
    next_run_at: cfg.next_run_at ?? null,
    // Honest, live signal: reflects whether the durable LaunchAgent is installed
    // right now (plist present), so installing/uninstalling flips this with no
    // restart or config write.
    reboot_durable: isServiceInstalled(),
  };
}

// CORS: loopback dev origins + the specific Scout production hostname(s) +
// the founder's private Tailscale tailnet origin.
// Do NOT add wildcard *.vercel.app or *.github.io — any user of those
// platforms could make cross-origin requests to the companion.
//
// Tailscale (PER-157): the founder reaches the companion over his tailnet at
// `https://<machine>.<tailnet>.ts.net(:<port>)?`, NOT loopback. A browser there
// sends that Origin on every write (`POST /v0/interests` = Run now,
// `PUT /v0/interests`/`/v0/schedule`), so without it `isOriginDenied()` 403s the
// entire run path — exactly the founder's "run doesn't work". MagicDNS `.ts.net`
// names resolve only inside a user's own tailnet, so a public attacker site can
// never present such an Origin; the only cross-origin caller able to is a page
// served within the founder's own private tailnet — an acceptable trust boundary.
const CORS_ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/scout\.notiva\.no$/,
  /^https:\/\/hakon1233\.github\.io$/,
  /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?$/i,
  ...extraAllowedOrigins(),
];

// Optional operator-configured serving origins, so a non-tailnet deployment can
// be allowlisted without a code change (PER-157). Set SCOUT_ALLOWED_ORIGINS to a
// comma-separated list of exact origins, e.g.
//   SCOUT_ALLOWED_ORIGINS="https://news.example.com,https://news.example.com:8443"
// Each entry is matched exactly (scheme+host+port), never as a wildcard.
function extraAllowedOrigins(): RegExp[] {
  const raw = process.env.SCOUT_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(
      (origin) =>
        new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// True when the request is same-origin with this loopback server: either no
// Origin header (browsers omit it for same-origin GETs) or an explicit
// loopback origin. Used to gate `/v0/config`, which hands the page its pairing
// token — only the UI we serve (same-origin) should get it.
function isSameOriginCaller(origin: string | undefined): boolean {
  return !origin || LOOPBACK_ORIGIN.test(origin);
}

// True when a browser Origin is present but is NOT in our CORS allowlist. Such
// a caller has no legitimate business touching any /v0/* route, so we 403 it
// uniformly across the whole surface (defense in depth) instead of serving a
// no-ACAO 200 the browser would block from reading anyway. This keeps the
// origin-deny posture consistent: previously only /v0/config rejected a hostile
// Origin while /v0/briefs and /v0/interests served it. (PER-135)
//
// No-Origin callers (non-browser clients, or same-origin GETs where the browser
// omits Origin) pass this gate and remain subject to bearer auth. Allowlisted
// app origins (the hosted UI on github.io / vercel.app) also pass, since briefs
// and interests are designed to be called cross-origin by that UI. /v0/config
// stays stricter still — same-origin only — via isSameOriginCaller.
function isOriginDenied(origin: string | undefined): boolean {
  if (!origin) return false;
  return !CORS_ALLOWED_ORIGINS.some((rx) => rx.test(origin));
}

// Known /v0/* routes and the methods each accepts. OPTIONS is handled globally
// (CORS/PNA preflight) for every route, so it's always listed. Used to answer a
// wrong-method request on a KNOWN path with 405 Method Not Allowed + an `Allow`
// header, instead of the indistinguishable 404 a genuinely unknown path gets —
// so a client can tell "this route exists, wrong method" from "no such route".
// (PER-136)
const V0_ROUTE_METHODS: Record<string, readonly string[]> = {
  "/v0/config": ["GET", "OPTIONS"],
  "/v0/interests": ["GET", "POST", "PUT", "OPTIONS"],
  "/v0/briefs": ["GET", "OPTIONS"],
  "/v0/schedule": ["GET", "PUT", "OPTIONS"],
  "/v0/chat": ["GET", "POST", "OPTIONS"],
  "/v0/chat/confirm-delete": ["POST", "OPTIONS"],
};

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  if (!CORS_ALLOWED_ORIGINS.some((rx) => rx.test(origin))) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

// Request-body and per-interest bounds. The count is already capped at 6; these
// cap the remaining unbounded dimensions so an oversized body can't blow the
// companion's memory or get forwarded into the (expensive, ~5-min) Claude
// synthesis prompt. (PER-137)
//
// 16 KiB comfortably holds 6 interests of 200 chars each plus JSON framing and
// any whitespace/unicode escaping, with generous headroom.
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_INTEREST_LEN = 200;
// A single chat message. Generous enough for a paragraph of intent, bounded so an
// oversized turn can't be forwarded into the (model-priced) chat prompt. (PER-172)
export const MAX_CHAT_MESSAGE_LEN = 4000;

type InterestParse =
  | { ok: true; interests: string[] }
  | { ok: false; status: number; error: string };

// Clean → dedupe (case-insensitively, keeping first casing) → enforce the
// 1..6 count and per-interest length budget. Shared by POST /v0/interests
// (which also kicks a synthesis run) and PUT /v0/interests (persist-only,
// PER-160) so both apply the exact same rules. (Dedupe rationale: PER-126;
// length cap: PER-137.)
function parseInterestsPayload(raw: unknown): InterestParse {
  const cleaned = Array.isArray(raw)
    ? (raw as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const seen = new Set<string>();
  const interests = cleaned.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (interests.length === 0)
    return { ok: false, status: 400, error: "interests required" };
  if (interests.length > 6)
    return { ok: false, status: 400, error: "too many interests, max 6" };
  if (interests.some((s) => s.length > MAX_INTEREST_LEN))
    return {
      ok: false,
      status: 400,
      error: `interest too long, max ${MAX_INTEREST_LEN} chars`,
    };
  return { ok: true, interests };
}

// Thrown by readBody when the request body exceeds MAX_BODY_BYTES, so the
// handler can answer 413 instead of buffering an unbounded body into memory.
export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

async function readBody(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += buf.length;
    if (total > maxBytes) {
      // Stop buffering and tear down the connection so we never hold the whole
      // oversized payload in memory.
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (!h || Array.isArray(h)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function createServer(deps: ServerDeps = {}): http.Server {
  const stateFile = deps.stateFile ?? STATE_FILE;
  const claudeBin = deps.claudeBin;
  const spawnFn = deps.spawnFn;
  const webroot = deps.webroot;
  // Default the doc dir to `interests/` beside the state file so a tmp-stateFile
  // test automatically gets a tmp doc dir (the lazy backfill in startRun's
  // synthesis never touches the real ~/.config/scout). In production stateFile
  // is CONFIG_DIR/state.json, so this resolves to CONFIG_DIR/interests ===
  // docs.ts INTERESTS_DIR — exact parity. (C2/PER-171)
  const interestsDir =
    deps.interestsDir ?? path.join(path.dirname(stateFile), "interests");
  const chatTranscriptFile = defaultChatTranscriptFile(stateFile);

  async function authed(req: http.IncomingMessage): Promise<State | null> {
    const token = bearer(req);
    if (!token) return null;
    const state = await loadState(stateFile);
    if (!state.pairing_token || state.pairing_token !== token) return null;
    return state;
  }

  return http.createServer((req, res) => {
    const origin = req.headers.origin as string | undefined;
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") {
      // Private Network Access (PNA) preflight. Classic-PNA browsers
      // (Chrome ~104–~129 and Chromium forks that haven't shipped Local
      // Network Access yet) send an extra preflight carrying
      // `Access-Control-Request-Private-Network: true` when a public origin
      // (e.g. github.io) fetches this loopback server; they require us to
      // echo `Access-Control-Allow-Private-Network: true` or they deny it.
      // We honor that here for origins we already allow via CORS.
      //
      // IMPORTANT (verified on Chrome 148, 2026-05-30, PER-107): newer
      // Chrome replaced classic PNA with the *Local Network Access* (LNA)
      // model, which gates public→loopback behind a real USER PERMISSION
      // ("Allow local network"). In that model the request is blocked
      // before any preflight is sent, so this header is a NO-OP and cannot
      // remove the prompt. Removing the prompt requires not making a
      // public→loopback request at all (e.g. serve the UI from the
      // companion on a localhost origin). This header stays as correct,
      // harmless support for classic-PNA browsers — don't assume it solves
      // the LNA prompt.
      const wantsPrivateNetwork =
        req.headers["access-control-request-private-network"] === "true";
      const pna =
        wantsPrivateNetwork && Object.keys(cors).length > 0
          ? { "access-control-allow-private-network": "true" }
          : {};
      res.writeHead(204, { ...cors, ...pna });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    void (async () => {
      try {
        if (req.method === "GET" && url.pathname === "/healthz") {
          json(res, 200, { ok: true, version: PKG_VERSION }, cors);
          return;
        }

        // Uniform cross-origin deny gate for the whole /v0/* surface. A browser
        // Origin that isn't in the CORS allowlist is rejected with 403 before
        // any route handler runs, so /v0/config, /v0/briefs and /v0/interests
        // all share one origin-deny posture. (PER-135)
        if (url.pathname.startsWith("/v0/") && isOriginDenied(origin)) {
          return json(res, 403, { error: "forbidden" }, cors);
        }

        // Same-origin bootstrap: hand the served UI its pairing token so the
        // user never has to copy/paste it. When the page is served from this
        // companion (http://127.0.0.1:47821/), the fetch is same-origin and
        // this returns the token. A cross-origin (public) caller is refused —
        // and is in any case blocked by the browser's LNA gate before it ever
        // reaches us. The token only guards the browser-origin boundary; any
        // local process can already read ~/.config/scout/state.json, so this
        // adds no on-machine exposure.
        if (req.method === "GET" && url.pathname === "/v0/config") {
          if (!isSameOriginCaller(origin)) {
            return json(res, 403, { error: "forbidden" }, cors);
          }
          const state = await loadState(stateFile);
          json(
            res,
            200,
            {
              token: state.pairing_token ?? null,
              version: PKG_VERSION,
              // The companion is the source of truth for the user's interests
              // (persisted on every POST /v0/interests so the scheduler can run
              // headless). Hand them to the served UI too, so a browser whose
              // localStorage was cleared / is a different profile / a different
              // origin than the one that did first-run setup can still render the
              // brief + a working "Run now" instead of dead-ending on the setup
              // form (PER-157). Same-origin gated like the token above. Mapped to
              // topic strings for back-compat — the rich {id, topic} model lives
              // behind GET /v0/interests (PER-169); this endpoint's `interests`
              // contract stays a plain string[].
              interests: interestTopics(state.interests),
            },
            cors,
          );
          return;
        }

        // Rich interest list with per-interest intent-doc metadata (PER-169).
        // Unlike /v0/config (which flattens to topic strings for back-compat),
        // this is the authoritative shape the profile view consumes: each entry
        // is {id, topic, hasDoc, docUpdatedAt}. `hasDoc`/`docUpdatedAt` are read
        // straight from the doc store (docs.ts) so they can never drift from the
        // actual `<id>.md` files. Field names match what C3/PER-170's
        // fetchInterestDocMeta() already consumes, so the profile doc-indicator
        // lights up on real data with no FE change.
        if (req.method === "GET" && url.pathname === "/v0/interests") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const interests = state.interests ?? [];
          const withMeta = await Promise.all(
            interests.map(async (it) => {
              const [meta, doc] = await Promise.all([
                interestDocMeta(it.id, interestsDir),
                readInterestDoc(it.id, interestsDir),
              ]);
              return {
                id: it.id,
                topic: it.topic,
                hasDoc: meta.hasDoc,
                docUpdatedAt: meta.updatedAt ?? null,
                doc,
              };
            }),
          );
          json(res, 200, { interests: withMeta }, cors);
          return;
        }

        // Persist-only interests save (PER-160). The profile/edit view PUTs the
        // user's interests so the edit sticks in state.json on its own —
        // distinct from POST below, which ALSO kicks a (~5-min) synthesis run.
        // The scheduler reuses whatever is persisted here on its next fire.
        if (req.method === "PUT" && url.pathname === "/v0/interests") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const declaredLen = Number(req.headers["content-length"]);
          if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
            return json(res, 413, { error: "request body too large" }, cors);
          }
          let body: string;
          try {
            body = await readBody(req);
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              return json(res, 413, { error: "request body too large" }, cors);
            }
            throw err;
          }
          let parsed: { interests?: unknown };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }
          const validated = parseInterestsPayload(parsed.interests);
          if (!validated.ok)
            return json(
              res,
              validated.status,
              { error: validated.error },
              cors,
            );
          // Persist the rich {id, topic} model, preserving each existing topic's
          // id so its intent doc stays attached across an edit (PER-169). The
          // wire response stays a topic string[] for back-compat.
          const interests = reconcileInterests(
            state.interests,
            validated.interests,
          );
          await saveState({ ...state, interests }, stateFile);
          json(
            res,
            200,
            { interests: validated.interests, status: "saved" },
            cors,
          );
          return;
        }

        if (req.method === "POST" && url.pathname === "/v0/interests") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          // Fast reject on a declared oversized body before reading it at all.
          const declaredLen = Number(req.headers["content-length"]);
          if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
            return json(res, 413, { error: "request body too large" }, cors);
          }
          let body: string;
          try {
            body = await readBody(req);
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              return json(res, 413, { error: "request body too large" }, cors);
            }
            throw err;
          }
          let parsed: {
            interests?: unknown;
            retry_topics?: unknown;
            selected_topics?: unknown;
            ephemeral?: unknown;
          };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }
          const validated = parseInterestsPayload(parsed.interests);
          if (!validated.ok)
            return json(
              res,
              validated.status,
              { error: validated.error },
              cors,
            );
          const topics = validated.interests;
          // Reconcile into the rich {id, topic} model (preserving ids) before the
          // run persists them, so the doc store stays anchored across runs.
          const interests = reconcileInterests(state.interests, topics);

          // Case-insensitively map a wire topic back to its canonical interest
          // casing, dropping anything not in the current list (no stale/foreign
          // topics). Shared by the retry and run-selector subsets below.
          const interestByKey = new Map(
            topics.map((s) => [s.toLowerCase(), s]),
          );
          const intersectTopics = (raw: unknown): string[] =>
            Array.isArray(raw)
              ? Array.from(
                  new Set(
                    (raw as unknown[])
                      .filter((s): s is string => typeof s === "string")
                      .map((s) => interestByKey.get(s.trim().toLowerCase()))
                      .filter((s): s is string => Boolean(s)),
                  ),
                )
              : [];

          // Optional focused-retry payload (PER-154): re-research ONLY these
          // topics and merge the fresh sections into the prior brief, instead of
          // regenerating the whole brief.
          const retryTopics = intersectTopics(parsed.retry_topics);

          // Optional run-selector payload (C6/PER-173): research ONLY this subset
          // and produce a FRESH brief over just those topics. The full interest
          // list is STILL persisted by startRun (the scheduler's source of
          // truth) — a partial run never shrinks the saved set. Ignored by the
          // runner when a retry is set or when it covers the whole list.
          const selectedTopics = intersectTopics(parsed.selected_topics);

          // Ephemeral / dry-run trigger (PER-218): research the supplied topics
          // and produce a brief WITHOUT persisting them as the founder's saved
          // interests or touching the real intent-doc store. This is the path QA
          // and automation MUST use to fire test runs — a normal POST persists its
          // `interests` body as the new saved list, so a reduced test payload would
          // otherwise overwrite the founder's authored interests.
          const ephemeral = parsed.ephemeral === true;

          // One brief slot, last-writer-wins. The shared runner enforces single-
          // flight (in-memory guard + persisted pending check) so an on-demand
          // kick and a scheduled fire can never overlap (PER-151). It also
          // persists the interests so the scheduler can reuse them.
          const outcome = await startRun(
            interests,
            {
              stateFile,
              claudeBin,
              spawnFn,
              interestsDir,
              onSynthesisDone: deps.onSynthesisDone,
            },
            "on_demand",
            { retryTopics, selectedTopics, ephemeral },
          );
          if (!outcome.started) {
            // A retry asked for but there's no prior brief to merge into → tell
            // the client to fall back to a full run rather than silently doing
            // nothing (no dead controls, PER-139/PER-154).
            if (outcome.reason === "no_base_brief") {
              return json(
                res,
                409,
                { error: "no base brief to retry; run a full brief first" },
                cors,
              );
            }
            // interests were validated non-empty above, so the only other reason
            // is a run already in flight → 409, echoing the in-flight id.
            const briefId =
              outcome.reason === "in_flight" ? outcome.briefId : undefined;
            return json(
              res,
              409,
              { error: "brief in progress", brief_id: briefId },
              cors,
            );
          }

          json(
            res,
            202,
            { brief_id: outcome.briefId, status: "pending" },
            cors,
          );
          return;
        }

        if (req.method === "GET" && url.pathname === "/v0/briefs") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          // Paginated history view (PER-219): when `limit` or `offset` is present,
          // page over the rolling ready-brief history (newest-first) instead of
          // the single last_brief. The feed uses this to render previous editions
          // 3 at a time. Response carries `total` so the client knows when to hide
          // its "Load older briefs" button. Absent both params → the legacy poller
          // contract below is preserved verbatim (returns the single last_brief
          // slot, including pending/failed, filtered by `since`).
          const limitRaw = url.searchParams.get("limit");
          const offsetRaw = url.searchParams.get("offset");
          if (limitRaw !== null || offsetRaw !== null) {
            const clamp = (raw: string | null, def: number, max: number) => {
              const n = Number(raw);
              if (!Number.isFinite(n)) return def;
              return Math.min(max, Math.max(0, Math.floor(n)));
            };
            const limit = Math.max(1, clamp(limitRaw, 3, 50));
            const offset = clamp(offsetRaw, 0, Number.MAX_SAFE_INTEGER);
            const history = state.briefs ?? [];
            const page = history.slice(offset, offset + limit);
            json(res, 200, { briefs: page, total: history.length }, cors);
            return;
          }
          const since = url.searchParams.get("since");
          const last = state.last_brief;
          const matches =
            last && (!since || last.generated_at > since) ? [last] : [];
          json(res, 200, { briefs: matches }, cors);
          return;
        }

        // Kick one chat turn over the interest collection (PER-172 / C4). Async
        // kick + poll, exactly like POST /v0/interests: we persist a `pending`
        // turn and fire the (model-priced) round-trip fire-and-forget, returning
        // 202 immediately. The caller polls GET /v0/chat?since= for the reply +
        // the machine-readable change set the turn applied. Single chat slot,
        // last-writer-wins → 409 while a turn is already pending (mirrors the
        // brief single-flight), so two turns can't race on the interest set.
        if (req.method === "POST" && url.pathname === "/v0/chat") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const declaredLen = Number(req.headers["content-length"]);
          if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
            return json(res, 413, { error: "request body too large" }, cors);
          }
          let body: string;
          try {
            body = await readBody(req);
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              return json(res, 413, { error: "request body too large" }, cors);
            }
            throw err;
          }
          let parsed: { message?: unknown };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }
          const message =
            typeof parsed.message === "string" ? parsed.message.trim() : "";
          if (!message)
            return json(res, 400, { error: "message required" }, cors);
          if (message.length > MAX_CHAT_MESSAGE_LEN) {
            return json(
              res,
              400,
              { error: `message too long, max ${MAX_CHAT_MESSAGE_LEN} chars` },
              cors,
            );
          }
          const outcome = await startChatTurn(message, {
            stateFile,
            interestsDir,
            chatTranscriptFile,
            claudeBin,
            spawnFn,
            onChatDone: deps.onChatDone,
          });
          if (!outcome.started) {
            // The only non-empty reason here is in_flight (message was validated
            // non-empty above) → 409, echoing the in-flight turn id.
            const turnId =
              outcome.reason === "in_flight" ? outcome.turnId : undefined;
            return json(
              res,
              409,
              { error: "chat turn in progress", turn_id: turnId },
              cors,
            );
          }
          json(res, 202, { turn_id: outcome.turnId, status: "pending" }, cors);
          return;
        }

        // Confirm a gated delete (PER-230). The destructive op is the ONLY one
        // behind a confirmation: a model turn that resolved to a delete returns
        // a `pending_delete` proposal (the interest stays alive); the FE renders
        // a [Delete]/[Cancel] card and calls this route ONLY when the user presses
        // [Delete]. Deterministic — no model spawn — so it returns the applied
        // turn synchronously (200) for the FE to flash + drop the docs-rail card.
        if (
          req.method === "POST" &&
          url.pathname === "/v0/chat/confirm-delete"
        ) {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          let body: string;
          try {
            body = await readBody(req);
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              return json(res, 413, { error: "request body too large" }, cors);
            }
            throw err;
          }
          let parsed: { interestId?: unknown };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }
          const interestId =
            typeof parsed.interestId === "string" ? parsed.interestId : "";
          if (!interestId)
            return json(res, 400, { error: "interestId required" }, cors);
          const outcome = await confirmDeleteTurn(interestId, {
            stateFile,
            interestsDir,
            chatTranscriptFile,
            claudeBin,
            spawnFn,
            onChatDone: deps.onChatDone,
          });
          if (!outcome.ok) {
            if (outcome.reason === "in_flight") {
              return json(res, 409, { error: "chat turn in progress" }, cors);
            }
            return json(res, 404, { error: "interest not found" }, cors);
          }
          json(res, 200, { turn: outcome.turn }, cors);
          return;
        }

        // Poll the latest chat turn (PER-172). Mirrors GET /v0/briefs: returns the
        // single held turn when it's newer than `since` (its reply + applied
        // changes once `ready`), else []. The FE polls this until `status` flips
        // off `pending`, then renders the reply and re-`GET /v0/interests` (or
        // applies `changes` in place) — the "Updated" beat fires on the confirmed
        // change set, never a hopeful guess (PER-139).
        if (req.method === "GET" && url.pathname === "/v0/chat") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const since = url.searchParams.get("since");
          const transcript = await readChatTranscript(chatTranscriptFile);
          const last = state.last_chat;
          const byId = new Map(transcript.map((turn) => [turn.id, turn]));
          if (last && !byId.has(last.id)) byId.set(last.id, last);
          const matches = Array.from(byId.values())
            .filter((turn) => !since || turn.created_at > since)
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          json(res, 200, { turns: matches }, cors);
          return;
        }

        // Read the persisted recurring-schedule config + last/next-run telemetry
        // for the Settings UI (PER-152). Materializes the default schedule on
        // first read so the UI always has something concrete to render.
        if (req.method === "GET" && url.pathname === "/v0/schedule") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          const cfg = state.schedule ?? defaultSchedule();
          json(res, 200, scheduleView(cfg), cors);
          return;
        }

        // Write the schedule config (enable/disable + time-of-day). Telemetry
        // fields are read-only here. After persisting we ask the running
        // scheduler to re-arm so the change takes effect without a restart.
        if (req.method === "PUT" && url.pathname === "/v0/schedule") {
          const state = await authed(req);
          if (!state) return json(res, 401, { error: "unauthorized" }, cors);
          let body: string;
          try {
            body = await readBody(req);
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              return json(res, 413, { error: "request body too large" }, cors);
            }
            throw err;
          }
          let parsed: { enabled?: unknown; time_of_day?: unknown };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return json(res, 400, { error: "invalid json" }, cors);
          }

          const current = state.schedule ?? defaultSchedule();
          let enabled = current.enabled;
          if (parsed.enabled !== undefined) {
            if (typeof parsed.enabled !== "boolean") {
              return json(
                res,
                400,
                { error: "enabled must be a boolean" },
                cors,
              );
            }
            enabled = parsed.enabled;
          }
          let timeOfDay = current.time_of_day;
          if (parsed.time_of_day !== undefined) {
            const normalized = normalizeTimeOfDay(parsed.time_of_day);
            if (!normalized) {
              return json(
                res,
                400,
                { error: "time_of_day must be 'HH:MM' (24h)" },
                cors,
              );
            }
            timeOfDay = normalized;
          }

          const next: ScheduleConfig = {
            ...current,
            enabled,
            time_of_day: timeOfDay,
          };
          await saveState({ ...state, schedule: next }, stateFile);
          // Re-arm the live scheduler; it also persists the recomputed
          // next_run_at, so re-read before returning the view.
          await deps.onScheduleChanged?.();
          const fresh = await loadState(stateFile);
          json(res, 200, scheduleView(fresh.schedule ?? next), cors);
          return;
        }

        // Static UI fallback. Serve the bundled Next export for any GET/HEAD
        // that didn't match an API route. Same-origin with the API above, so
        // the browser never makes a public→loopback request → no LNA prompt.
        if (req.method === "GET" || req.method === "HEAD") {
          // Match Next `trailingSlash: true` / GitHub Pages: 301 a directory
          // route hit without its trailing slash (e.g. /app/connect →
          // /app/connect/) so the companion and github.io behave identically.
          const redirectTo = await trailingSlashRedirect(url.pathname, webroot);
          if (redirectTo) {
            res.writeHead(301, {
              location: redirectTo + url.search,
              "cache-control": "no-cache",
            });
            res.end();
            return;
          }
          // Static export, then SPA fallback to the /app/ shell for unmatched
          // in-app deep-links/refreshes so they don't hard-404 (PER-127).
          const hit =
            (await resolveStatic(url.pathname, webroot)) ??
            (await resolveAppShellFallback(url.pathname, webroot));
          if (hit) {
            res.writeHead(200, {
              "content-type": hit.contentType,
              "content-length": String(hit.body.length),
              // Hashed _next assets are immutable; HTML must revalidate.
              "cache-control": url.pathname.startsWith("/_next/")
                ? "public, max-age=31536000, immutable"
                : "no-cache",
            });
            res.end(req.method === "HEAD" ? undefined : hit.body);
            return;
          }
        }

        // Known route, unsupported method → 405 + Allow (REST-correct), so it's
        // distinguishable from a genuinely unknown path's 404. (PER-136)
        const allowed = V0_ROUTE_METHODS[url.pathname];
        if (allowed) {
          return json(
            res,
            405,
            { error: "method not allowed" },
            { ...cors, allow: allowed.join(", ") },
          );
        }

        // A GET/HEAD for a genuinely-unknown *route* (not caught by the SPA
        // fallback above) should land on the export's styled 404 page with a
        // "← back to your brief" link, not the raw JSON dump a user would
        // otherwise see. Covers browser navigations (Accept: text/html) and
        // bare/`*/*` clients (curl, a directly-typed stray URL) alike — anyone
        // who could be a human. Asset misses (e.g. /app/missing.js — a path
        // with a file extension) and explicit JSON API clients
        // (Accept: application/json without text/html) still get the
        // machine-readable JSON 404. (PER-144, broadened by PER-148)
        if (req.method === "GET" || req.method === "HEAD") {
          const accept = (req.headers.accept as string | undefined) ?? "";
          const wantsJsonOnly =
            accept.includes("application/json") &&
            !accept.includes("text/html");
          const looksLikeAsset = /\.[a-z0-9]+$/i.test(url.pathname);
          if (!wantsJsonOnly && !looksLikeAsset) {
            const page = await resolveStatic("/404.html", webroot);
            if (page) {
              res.writeHead(404, {
                "content-type": page.contentType,
                "content-length": String(page.body.length),
                "cache-control": "no-cache",
              });
              res.end(req.method === "HEAD" ? undefined : page.body);
              return;
            }
          }
        }

        json(res, 404, { error: "not found" }, cors);
      } catch (err) {
        json(res, 500, { error: String(err) }, cors);
      }
    })();
  });
}

export async function startServer(
  port: number = DEFAULT_PORT,
  deps: ServerDeps = {},
): Promise<{ server: http.Server; port: number }> {
  const server = createServer(deps);
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  return { server, port: boundPort };
}
