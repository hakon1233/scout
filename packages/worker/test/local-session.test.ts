// POST /team/local-session: the Scout team account's session for the Mac's
// gateway, with Supabase Auth and PostgREST stubbed. No network.

import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, type HttpDeps } from "../src/http.ts";
import { LOCAL_ACCOUNT_EMAIL } from "../src/local-session.ts";

const SUPABASE = "https://ref.supabase.test";
const USER = "7e57a000-0000-4000-8000-0000000000aa";

type Call = { method: string; path: string; headers: Headers; body: unknown };

// A Supabase that keeps one user table and mints a session per magic link.
function stubSupabase(opts: { verifyStatus?: number } = {}) {
  const users = new Map<string, string>();
  const calls: Call[] = [];
  let minted = 0;
  const patched: unknown[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({
      method: init.method ?? "GET",
      path: u.pathname + u.search,
      headers: new Headers(init.headers),
      body,
    });
    const reply = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), { status });
    switch (u.pathname) {
      case "/auth/v1/admin/users":
        if (users.has(body.email))
          return reply(422, { code: 422, error_code: "email_exists" });
        users.set(body.email, USER);
        return reply(200, { id: USER, email: body.email });
      case "/auth/v1/admin/generate_link":
        if (!users.has(body.email)) return reply(404, {});
        return reply(200, {
          id: users.get(body.email),
          hashed_token: `hash-${++minted}`,
          verification_type: "magiclink",
        });
      case "/auth/v1/verify":
        if (opts.verifyStatus) return reply(opts.verifyStatus, {});
        return reply(200, {
          access_token: `access-${body.token_hash}`,
          refresh_token: `refresh-${body.token_hash}`,
          expires_in: 3600,
          token_type: "bearer",
          user: { id: USER },
        });
      case "/rest/v1/profiles":
        patched.push(body);
        return new Response(null, { status: 204 });
    }
    return reply(404, {});
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, users, patched };
}

function session(
  deps: Partial<HttpDeps> & { fetch: typeof globalThis.fetch },
  auth = "Bearer team-secret",
  method = "POST",
) {
  return handleRequest(
    new Request("https://runs.example.test/team/local-session", {
      method,
      headers: { authorization: auth },
    }),
    {
      supabaseUrl: SUPABASE,
      anonKey: "anon-key",
      allowedOrigin: "https://app.example.test",
      serviceKey: "service-key",
      teamToken: "team-secret",
      ...deps,
    },
  );
}

test("a missing or wrong token gets 401 and touches nothing", async () => {
  const sb = stubSupabase();
  for (const auth of ["", "Bearer nope", "Bearer service-key", "team-secret"])
    assert.equal((await session({ fetch: sb.fetch }, auth)).status, 401);
  assert.equal(sb.calls.length, 0);
});

test("without TEAM_RUNNER_TOKEN or the service key the route does not exist", async () => {
  const sb = stubSupabase();
  assert.equal(
    (await session({ fetch: sb.fetch, teamToken: undefined })).status,
    404,
  );
  assert.equal(
    (await session({ fetch: sb.fetch, serviceKey: undefined })).status,
    404,
  );
  assert.equal(
    (await session({ fetch: sb.fetch }, "Bearer team-secret", "GET")).status,
    405,
  );
  assert.equal(sb.calls.length, 0);
});

test("creates the account once, marks it local, and returns a fresh session each call", async () => {
  const sb = stubSupabase();
  const first = await session({ fetch: sb.fetch });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await first.json(), {
    accessToken: "access-hash-1",
    refreshToken: "refresh-hash-1",
    expiresIn: 3600,
    tokenType: "bearer",
  });
  const second = await session({ fetch: sb.fetch });
  assert.equal(second.status, 200);
  assert.equal(
    ((await second.json()) as { accessToken: string }).accessToken,
    "access-hash-2",
  );

  // One user, under the placeholder address, named Scout team.
  assert.equal(sb.users.size, 1);
  const create = sb.calls.find((c) => c.path === "/auth/v1/admin/users");
  assert.deepEqual(create?.body, {
    email: LOCAL_ACCOUNT_EMAIL,
    email_confirm: true,
    user_metadata: { display_name: "Scout team" },
  });
  assert.match(LOCAL_ACCOUNT_EMAIL, /\.invalid$/);
  // Every Auth call is the service role's; the link is never mailed (the
  // admin API returns it), and verify spends its hash.
  for (const c of sb.calls)
    assert.equal(c.headers.get("authorization"), "Bearer service-key");
  const links = sb.calls.filter(
    (c) => c.path === "/auth/v1/admin/generate_link",
  );
  assert.deepEqual(links[0].body, {
    type: "magiclink",
    email: LOCAL_ACCOUNT_EMAIL,
  });
  const verifies = sb.calls.filter((c) => c.path === "/auth/v1/verify");
  assert.deepEqual(verifies[1].body, {
    type: "magiclink",
    token_hash: "hash-2",
  });
  // The profile is marked local, by id.
  const marks = sb.calls.filter((c) => c.method === "PATCH");
  assert.equal(marks.length, 2);
  assert.equal(marks[0].path, `/rest/v1/profiles?id=eq.${USER}`);
  assert.deepEqual(sb.patched[0], { runs_local: true });
});

test("a failed Auth step gets 502, and no session", async () => {
  const sb = stubSupabase({ verifyStatus: 403 });
  const res = await session({ fetch: sb.fetch });
  assert.equal(res.status, 502);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.accessToken, undefined);
  assert.equal(sb.patched.length, 0);
});
