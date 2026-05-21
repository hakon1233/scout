// Supabase Edge Function: exa-search
// POST { query: string, numResults?: number } -> Exa results, rate-limited per user.
//
// Auth: the companion sends `Authorization: Bearer <companion-jwt>`. We verify the JWT
// using the Supabase client (anon key + setSession), which gives us the user id and
// enforces RLS for the usage counter increment.
//
// Rate limit: 50 searches/user/day. We upsert into `usage_exa_daily` with service-role
// privilege to bump the counter atomically.
//
// BYO-key escape hatch: if EXA_API_KEY is not configured for this function, we return
// 403 byo_key_required. The CLI then falls back to the user's own Exa key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXA_API_KEY = Deno.env.get("EXA_API_KEY");
const DAILY_CAP = parseInt(Deno.env.get("EXA_DAILY_CAP") ?? "50", 10);
const EXA_URL = "https://api.exa.ai/search";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!EXA_API_KEY) return json({ error: "byo_key_required" }, 403);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "missing_token" }, 401);

  // Verify token + extract user id.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: "invalid_token" }, 401);
  const userId = userData.user.id;

  let body: { query?: string; numResults?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const query = (body.query ?? "").trim();
  const numResults = Math.min(Math.max(body.numResults ?? 4, 1), 10);
  if (!query) return json({ error: "missing_query" }, 400);

  // Atomic counter bump with cap enforcement (service-role bypasses RLS).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
  const today = new Date().toISOString().slice(0, 10);
  const { data: row, error: rateErr } = await admin.rpc("bump_exa_usage", {
    p_user_id: userId,
    p_day: today,
    p_cap: DAILY_CAP,
  });
  if (rateErr) return json({ error: "rate_check_failed", detail: rateErr.message }, 500);
  if (row === null || row === false) return json({ error: "rate_limited", cap: DAILY_CAP }, 429);

  // Forward to Exa.
  const exaRes = await fetch(EXA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": EXA_API_KEY },
    body: JSON.stringify({
      query,
      numResults,
      type: "neural",
      useAutoprompt: true,
      startPublishedDate: isoDaysAgo(14),
      contents: { text: { maxCharacters: 1800 } },
    }),
  });

  const text = await exaRes.text();
  return new Response(text, {
    status: exaRes.status,
    headers: { "content-type": exaRes.headers.get("content-type") ?? "application/json" },
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}
