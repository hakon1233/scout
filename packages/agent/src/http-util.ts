// Shared HTTP plumbing for the loopback server (PER-274 / H2 decomposition).
// Everything request-shaped that more than one route needs lives here — CORS
// origin policy, JSON responses, and the size-guarded body reader — so no route
// module can quietly re-implement (and drift on) limits or origin handling.
// Route handlers live in routes/*.ts; the router/dispatch is server.ts.

import http from "node:http";
import { timingSafeEqual } from "node:crypto";

import { MAX_BODY_BYTES } from "./limits.js";

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

const HOST_ALLOWED_HOSTNAMES = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^::1$/,
  /^scout\.notiva\.no$/i,
  /^hakon1233\.github\.io$/i,
  /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i,
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

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host || host.includes(",")) return null;
  try {
    return normalizeHostname(new URL(`http://${host}`).hostname);
  } catch {
    return null;
  }
}

// isHostAllowed runs on every single request (server.ts's Host-header gate,
// ahead of routing), so re-splitting/re-parsing SCOUT_ALLOWED_ORIGINS on every
// call is wasted work at volume. Cache keyed by the raw env value rather than
// memoized once at module load: PER-276's test flips SCOUT_ALLOWED_ORIGINS
// AFTER the server has already started and expects the very next request to
// see the new value, with no restart — a plain one-shot memo would break that.
let cachedRawAllowedOrigins: string | undefined;
let cachedAllowedOriginHostnames: string[] = [];

function extraAllowedOriginHostnames(): string[] {
  const raw = process.env.SCOUT_ALLOWED_ORIGINS;
  if (raw === cachedRawAllowedOrigins) return cachedAllowedOriginHostnames;
  cachedRawAllowedOrigins = raw;
  cachedAllowedOriginHostnames = !raw
    ? []
    : raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .flatMap((origin) => {
          try {
            return [normalizeHostname(new URL(origin).hostname)];
          } catch {
            return [];
          }
        });
  return cachedAllowedOriginHostnames;
}

export function isHostAllowed(host: string | undefined): boolean {
  const hostname = hostnameFromHostHeader(host);
  if (!hostname) return false;
  if (HOST_ALLOWED_HOSTNAMES.some((rx) => rx.test(hostname))) return true;
  return extraAllowedOriginHostnames().includes(hostname);
}

export function timingSafeTokenEqual(
  expected: string | undefined,
  actual: string | undefined,
): boolean {
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

// True when the request is same-origin with this server: either no Origin header
// (browsers omit it for same-origin GETs) or an explicit Origin whose host
// matches the request Host exactly. Used to gate `/v0/config`, which hands the
// page its pairing token — only the UI we serve (same-origin) should get it.
export function isSameOriginCaller(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!origin) return true;
  if (!host) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
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
export function isOriginDenied(origin: string | undefined): boolean {
  if (!origin) return false;
  return !CORS_ALLOWED_ORIGINS.some((rx) => rx.test(origin));
}

export function corsHeaders(
  origin: string | undefined,
): Record<string, string> {
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

export function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

// Request-body cap, applied uniformly to every mutating /v0 route via
// parseJsonBody below. Defined in limits.ts next to the interest count and
// length it is derived from, and re-exported here so existing importers are
// unaffected. (PER-137)
export { MAX_BODY_BYTES };

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
      // oversized payload in memory. CAVEAT (AIR-640): req.destroy() also kills
      // the shared socket, so on the streaming path (chunked / absent /
      // under-declared content-length) the caller's 413 can't reach the client —
      // it gets an ECONNRESET instead. Memory protection is intact; the
      // response-correctness fix is tracked in AIR-640. An accurately-declared
      // oversized body never reaches here: parseJsonBody fast-rejects it with a
      // clean 413 (socket intact) before readBody runs.
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type JsonBodyParse<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; error: string };

// Read, size-guard, and JSON-parse a request body in one step. Consolidates the
// content-length pre-reject + readBody + BodyTooLargeError + JSON.parse(body ||
// "{}") dance that every mutating /v0 route had copy-pasted verbatim (7 copies
// across PER-160…PER-235, a classic drift hazard). The content-length
// fast-reject is now applied uniformly — readBody already enforces the cap, so
// adding it to the routes that lacked it only rejects an oversized declared body
// a little sooner.
export async function parseJsonBody<T>(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<JsonBodyParse<T>> {
  const declaredLen = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    return { ok: false, status: 413, error: "request body too large" };
  }
  let body: string;
  try {
    body = await readBody(req, maxBytes);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return { ok: false, status: 413, error: "request body too large" };
    }
    throw err;
  }
  try {
    // A literal JSON `null` body parses to `null` (the `|| "{}"` guard only
    // catches the empty string — "null" is non-empty). Every caller derefs a
    // field on `body`, so returning `null` here throws a TypeError in the
    // handler → 500, instead of the clean 400 an unusable body should get.
    // Coerce `null` → `{}` so a `null` body reads as "no fields present".
    const parsed = JSON.parse(body || "{}") as T | null;
    return { ok: true, body: (parsed ?? {}) as T };
  } catch {
    return { ok: false, status: 400, error: "invalid json" };
  }
}

export function jsonBodyParseError(
  res: http.ServerResponse,
  parsed: Extract<JsonBodyParse<unknown>, { ok: false }>,
  cors: Record<string, string>,
): void {
  json(res, parsed.status, { error: parsed.error }, cors);
}

export function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (!h || Array.isArray(h)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}
