// Shared HTTP plumbing for the loopback server.
// Everything request-shaped that more than one route needs lives here — CORS
// origin policy, JSON responses, and the size-guarded body reader — so no route
// module can quietly re-implement (and drift on) limits or origin handling.
// Route handlers live in routes/*.ts; the router/dispatch is server.ts.

import http from "node:http";
import { timingSafeEqual } from "node:crypto";

import { MAX_BODY_BYTES } from "./limits.js";

// Which browser origins may call the companion, and which Host names it
// answers to (the Host check defeats DNS rebinding). Loopback and the hosted UI
// are always allowed. Anything else, such as a `tailscale serve` URL or a
// self-hosted UI, is opted into with SCOUT_ALLOWED_ORIGINS: a comma-separated
// list of exact origins, e.g.
//   SCOUT_ALLOWED_ORIGINS="https://my-mac.example.net:48721"
// No wildcards: a pattern covering a proxy's whole domain would also admit
// other people's public sites on that domain (Tailscale Funnel, for one).
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];
// The static UI on GitHub Pages calls the reader's loopback companion.
const HOSTED_UI_ORIGIN = "https://hakon1233.github.io";

// Parsed once per distinct env value, so a test can change the variable
// between requests without restarting the server.
let configuredRaw: string | undefined;
let configured: string[] = [];

function configuredOrigins(): string[] {
  const raw = process.env.SCOUT_ALLOWED_ORIGINS;
  if (raw === configuredRaw) return configured;
  configuredRaw = raw;
  configured = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        return [new URL(entry).origin];
      } catch {
        return [];
      }
    });
  return configured;
}

function isAllowedOrigin(origin: string): boolean {
  return (
    LOOPBACK_ORIGIN.test(origin) ||
    origin === HOSTED_UI_ORIGIN ||
    configuredOrigins().includes(origin)
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

export function isHostAllowed(host: string | undefined): boolean {
  const hostname = hostnameFromHostHeader(host);
  if (!hostname) return false;
  if (LOOPBACK_HOSTNAMES.includes(hostname)) return true;
  return configuredOrigins().some(
    (origin) => normalizeHostname(new URL(origin).hostname) === hostname,
  );
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

// True when the request comes from a page this server (or its HTTPS proxy)
// served. Gates `/v0/config`, which hands out the pairing token. Browsers omit
// Origin on same-origin GETs but send `Sec-Fetch-Site: same-origin`; a caller
// with neither header (curl, or the claude child's WebFetch following an
// injected link) is refused, as is any Origin other than this host.
export function isSameOriginCaller(
  origin: string | undefined,
  host: string | undefined,
  secFetchSite: string | undefined,
): boolean {
  if (!origin) return secFetchSite === "same-origin";
  if (!host) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

// True when a browser Origin is present but is NOT in our CORS allowlist. Such
// a caller has no legitimate business touching any /v0/* route, so we 403 it
// uniformly across the whole surface (defense in depth) instead of serving a
// no-ACAO 200 the browser would block from reading anyway. This keeps the
// origin-deny posture consistent across every route.
//
// No-Origin callers (non-browser clients, or same-origin GETs where the browser
// omits Origin) pass this gate and remain subject to bearer auth. Allowlisted
// app origins (the hosted UI and SCOUT_ALLOWED_ORIGINS) also pass, since briefs
// and interests are designed to be called cross-origin by that UI. /v0/config
// stays stricter still — same-origin only — via isSameOriginCaller.
export function isOriginDenied(origin: string | undefined): boolean {
  if (!origin) return false;
  return !isAllowedOrigin(origin);
}

export function corsHeaders(
  origin: string | undefined,
): Record<string, string> {
  if (!origin) return {};
  if (!isAllowedOrigin(origin)) return {};
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
      // oversized payload in memory. CAVEAT: req.destroy() also kills the
      // shared socket, so on the streaming path (chunked / absent /
      // under-declared content-length) the caller's 413 can't reach the client —
      // it gets an ECONNRESET instead. Memory protection is intact; the lost
      // 413 is a known gap. An accurately-declared oversized body never reaches
      // here: parseJsonBody fast-rejects it with a clean 413 (socket intact)
      // before readBody runs.
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
// "{}") dance that every mutating /v0 route had copy-pasted verbatim (7 copies,
// a classic drift hazard). The content-length
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
