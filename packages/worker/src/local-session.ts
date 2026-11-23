// POST /team/local-session (core's local-session.ts): a fresh Supabase session
// for the Scout team's local account, for the Mac's gateway, which holds
// TEAM_RUNNER_TOKEN. No CORS: a browser page cannot call it.
//
// The account has a placeholder address under `.invalid` (RFC 2606), so no
// mail can ever reach anyone. Supabase Auth only checks an address's format
// when it creates a user or a link; its deliverability checks run only when it
// sends mail, and none of these calls sends any:
//   1. POST /auth/v1/admin/users (email_confirm): creates the user once; the
//      next calls get 422 email_exists, which is fine.
//   2. POST /auth/v1/admin/generate_link (magiclink): a one-time token hash,
//      returned to the caller instead of mailed.
//   3. POST /auth/v1/verify {type: magiclink, token_hash}: spends it for a
//      session (access + refresh token).
//   4. profiles.runs_local = true on every call, so the account stays local
//      even if its profile row was reset.
// The service key stays here; the gateway only ever sees the session.

import { LOCAL_ACCOUNT_NAME, type LocalSession } from "@scout/core";
import { bearerToken, jsonResponder, sameSecret } from "./request.ts";

export type LocalSessionDeps = {
  supabaseUrl: string;
  serviceKey?: string;
  teamToken?: string;
  fetch?: typeof fetch;
};

// Never deliverable (`.invalid` is reserved), and the lookup key that keeps
// the account's id stable.
export const LOCAL_ACCOUNT_EMAIL = "scout-team@local.scout.invalid";

const json = jsonResponder();

class AuthStepError extends Error {}

export async function handleLocalSession(
  request: Request,
  deps: LocalSessionDeps,
): Promise<Response> {
  if (!deps.teamToken || !deps.serviceKey)
    return json(404, { error: "not found" });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });
  const given = bearerToken(request);
  if (!given || !(await sameSecret(given, deps.teamToken)))
    return json(401, { error: "wrong token" });

  const doFetch = deps.fetch ?? globalThis.fetch;
  const base = deps.supabaseUrl.replace(/\/+$/, "");
  const key = deps.serviceKey;
  const call = async (path: string, init: RequestInit) => {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // A non-JSON answer reads as {}; the status decides.
    }
    return { status: res.status, body };
  };

  try {
    const created = await call("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: LOCAL_ACCOUNT_EMAIL,
        email_confirm: true,
        user_metadata: { display_name: LOCAL_ACCOUNT_NAME },
      }),
    });
    const exists =
      created.status === 422 &&
      /email_exists|already/i.test(
        `${created.body.error_code ?? ""} ${created.body.code ?? ""} ${created.body.msg ?? ""}`,
      );
    if (!(created.status >= 200 && created.status < 300) && !exists)
      throw new AuthStepError(`create user: ${created.status}`);

    const link = await call("/auth/v1/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", email: LOCAL_ACCOUNT_EMAIL }),
    });
    const props = (link.body.properties ?? link.body) as Record<
      string,
      unknown
    >;
    const tokenHash = props.hashed_token;
    if (link.status !== 200 || typeof tokenHash !== "string" || !tokenHash)
      throw new AuthStepError(`generate link: ${link.status}`);

    const verified = await call("/auth/v1/verify", {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
    });
    const s = verified.body;
    const userId = (s.user as { id?: unknown } | undefined)?.id;
    if (
      verified.status !== 200 ||
      typeof s.access_token !== "string" ||
      typeof s.refresh_token !== "string" ||
      typeof userId !== "string"
    )
      throw new AuthStepError(`verify: ${verified.status}`);

    const marked = await call(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ runs_local: true }),
      },
    );
    if (marked.status >= 300)
      throw new AuthStepError(`mark local: ${marked.status}`);

    const session: LocalSession = {
      accessToken: s.access_token,
      refreshToken: s.refresh_token,
      expiresIn:
        typeof s.expires_in === "number" && s.expires_in > 0
          ? s.expires_in
          : 3600,
      tokenType: "bearer",
    };
    return json(200, session);
  } catch (err) {
    // Statuses only: Auth's answers can hold the address or a token.
    console.error(
      "[local-session]",
      err instanceof AuthStepError ? err.message : "Supabase did not answer",
    );
    return json(502, { error: "Supabase did not answer" });
  }
}
