// The Cloudflare Worker: wiring only. The cron tick runs runDue with the
// Supabase queue and the Anthropic client; fetch serves run-now and the chat.
// Secrets (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SUPABASE_ANON_KEY,
// VAPID_PRIVATE_KEY, and optionally TEAM_RUNNER_TOKEN and MODERATION_TOKEN)
// come from `wrangler secret put`, never from a file.

import { anthropicClient } from "@scout/research";
import { handleRequest } from "./http.ts";
import { briefReadyNotifier } from "./push.ts";
import { DEFAULT_BATCH, notifyBudget, runDue } from "./run-due.ts";
import { supabasePushStore, supabaseQueue } from "./supabase.ts";

export {
  runDue,
  type RunQueue,
  type ClaimedRun,
  type RunOutcome,
} from "./run-due.ts";

export type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
  RUN_BATCH?: string;
  // Web Push (push.ts). Without the private key, no pushes are sent.
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  // The Scout team runner's /team routes (team.ts). Unset, they do not exist.
  TEAM_RUNNER_TOKEN?: string;
  // /team/hide, for the weekly public topic check. Unset, it does not exist.
  MODERATION_TOKEN?: string;
};

// "Your brief is ready" pushes, or none without the VAPID pair.
function notifier(env: Env, budget?: number) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return undefined;
  return briefReadyNotifier({
    store: supabasePushStore({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    vapid: {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
    subject: env.VAPID_SUBJECT ?? "https://hakon1233.github.io/scout/",
    budget,
  });
}

const worker = {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const batchSize = Number(env.RUN_BATCH ?? DEFAULT_BATCH);
    const summary = await runDue({
      queue: supabaseQueue({
        url: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
      claude: anthropicClient({ apiKey: env.ANTHROPIC_API_KEY }),
      batchSize,
      notify: notifier(env, notifyBudget(batchSize)),
    });
    if (summary.claimed) console.log("run queue tick", summary);
  },

  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      allowedOrigin: env.ALLOWED_ORIGIN,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      claude: anthropicClient({ apiKey: env.ANTHROPIC_API_KEY }),
      teamToken: env.TEAM_RUNNER_TOKEN,
      moderationToken: env.MODERATION_TOKEN,
      // One run per request: the free plan's 50 subrequests leave room.
      notify: notifier(env, 40),
    });
  },
};

export default worker;
