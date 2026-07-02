// Supabase Edge Function: companion-token
// POST { code: string } -> { access_token, refresh_token, user_id, expires_at }
//
// Flow:
//   1. Signed-in user clicks "Connect agent" in the web UI. The UI inserts a row into
//      `companion_pairings` (code = random base32, expires_at = now + 10m).
//   2. The user runs `npx @scout/agent pair` on their laptop and pastes the code.
//   3. The CLI POSTs the code here. We look up the row using service-role, refuse if
//      already used or expired, mark used_at, then mint a Supabase user JWT for that
//      user via the GoTrue admin API (`generateLink` -> followed by token exchange) OR
//      using `auth.admin.createUser` flow. For v0 we use the simpler approach:
//      we sign a JWT manually using the project's JWT secret with `sub` = user_id.
//
// Security:
//   - This function holds SUPABASE_SERVICE_ROLE_KEY and SUPABASE_JWT_SECRET.
//   - It never touches Anthropic tokens. The companion handles `claude` locally.
//   - Pairing codes are single-use and short-lived. Brute force is mitigated by the
//      code being 96 bits of entropy (16 base32 chars) — billions of years to guess
//      within a 10-minute window at any plausible rate.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create as createJWT, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET")!;
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h companion session

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const code = (body.code ?? "").trim().toUpperCase();
  if (!/^[A-Z2-7]{12,32}$/.test(code)) {
    return json({ error: "invalid_code_format" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Atomic claim: only mark used_at if the code is still unused and unexpired.
  const { data: claimed, error: claimErr } = await admin
    .from("companion_pairings")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .single();

  if (claimErr || !claimed) {
    return json({ error: "invalid_or_expired_code" }, 401);
  }

  const userId = claimed.user_id as string;

  // Mint a Supabase-compatible user JWT. PostgREST + Supabase Auth treat this as
  // an authenticated user, so RLS policies that compare to auth.uid() work.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const exp = getNumericDate(TOKEN_TTL_SECONDS);
  const access_token = await createJWT(
    { alg: "HS256", typ: "JWT" },
    {
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      iss: `${SUPABASE_URL}/auth/v1`,
      iat: getNumericDate(0),
      exp,
    },
    key,
  );

  // Record device for the "agent connected" status indicator.
  await admin
    .from("companion_devices")
    .insert({ user_id: userId, name: "cli", last_seen_at: new Date().toISOString() });

  return json({
    access_token,
    user_id: userId,
    expires_at: exp,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
