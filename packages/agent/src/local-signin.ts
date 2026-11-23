// The gateway's automatic sign-in (docs/ARCHITECTURE.md, "Signing in on the
// Mac"): GET LOCAL_SIGNIN_PATH signs the tailnet owner in to the Scout team
// account, with no email and no password.
//
// Only the tailnet owner: the request must carry `Tailscale-User-Login` equal
// to the configured login (SCOUT_LOCAL_ALLOWED_LOGIN). `tailscale serve` sets
// that header from the requester's identity and strips any copy a client sent
// (https://tailscale.com/kb/1312/serve, "Identity headers"); tagged devices
// and Funnel traffic get none. The gateway listens on 127.0.0.1 only, so the
// only way in from another machine is through `tailscale serve`. No login
// configured, no header, or another login: 403, and the Worker is not asked.
//
// Then the gateway asks the Worker for a fresh session (POST
// LOCAL_SESSION_PATH with TEAM_RUNNER_TOKEN) and redirects to the sign-in
// page with it in the URL fragment, as a Supabase email link does, so
// src/lib/auth.ts reads it there. The fragment never reaches a server.

import type { IncomingMessage, ServerResponse } from "node:http";
import { LOCAL_SESSION_PATH, type LocalSession } from "#core";

export { LOCAL_SIGNIN_PATH } from "#core";

export const TAILSCALE_LOGIN_HEADER = "tailscale-user-login";
export const SIGNIN_PAGE = "/app/signin/";

export type LocalSignInDeps = {
  workerUrl: string;
  token: string;
  // The tailnet owner's login; unset turns the route off (403).
  allowedLogin?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
};

const sameLogin = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function page(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

export function createLocalSignIn(deps: LocalSignInDeps) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? ((line: string) => console.log(line));
  const base = deps.workerUrl.replace(/\/+$/, "");
  const allowed = deps.allowedLogin?.trim() ?? "";

  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET" });
      res.end();
      return;
    }
    const login = req.headers[TAILSCALE_LOGIN_HEADER];
    if (!allowed || typeof login !== "string" || !sameLogin(login, allowed)) {
      page(res, 403, "This Scout signs in only its owner, over Tailscale.");
      return;
    }
    let session: LocalSession;
    try {
      const r = await doFetch(base + LOCAL_SESSION_PATH, {
        method: "POST",
        headers: { authorization: `Bearer ${deps.token}` },
        redirect: "manual",
      });
      if (r.status !== 200) throw new Error(`Worker answered ${r.status}`);
      session = (await r.json()) as LocalSession;
      if (!session.accessToken || !session.refreshToken)
        throw new Error("Worker sent no session");
    } catch (err) {
      log(`local sign-in: ${err instanceof Error ? err.message : String(err)}`);
      page(res, 502, "Scout couldn't sign you in right now. Try again.");
      return;
    }
    const fragment = new URLSearchParams({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: String(session.expiresIn),
      token_type: "bearer",
    });
    res.writeHead(302, {
      location: `${SIGNIN_PAGE}#${fragment}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };
}
