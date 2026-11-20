// The Cloudflare Worker: wiring only. The cron tick runs runDue with the
// Supabase queue and the Anthropic client; fetch serves run-now and the chat.
// Secrets (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SUPABASE_ANON_KEY,
// VAPID_PRIVATE_KEY) come from `wrangler secret put`, never from a file.

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
};

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
      notify:
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
          ? briefReadyNotifier({
              store: supabasePushStore({
                url: env.SUPABASE_URL,
                serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
              }),
              vapid: {
                publicKey: env.VAPID_PUBLIC_KEY,
                privateKey: env.VAPID_PRIVATE_KEY,
              },
              subject:
                env.VAPID_SUBJECT ?? "https://hakon1233.github.io/scout/",
              budget: notifyBudget(batchSize),
            })
          : undefined,
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
    });
  },
};

export default worker;
