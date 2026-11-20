// The Cloudflare Worker: wiring only. The minute tick runs runDue with the
// Supabase queue and the Anthropic client, then sends queued pushes with the
// subrequests left (after up to 3 readers' picks), and queued brief emails with
// a fixed slice of them; the daily cron cleans up and, on Mondays, queues the
// weekly push. fetch serves run-now, the chat, voice, delete account and the
// emails' unsubscribe link.
// Secrets (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SUPABASE_ANON_KEY,
// VAPID_PRIVATE_KEY, and optionally TEAM_RUNNER_TOKEN, MODERATION_TOKEN and
// RESEND_API_KEY) come from `wrangler secret put`, never from a file.

import { createPicks } from "@scout/hosted";
import { anthropicClient } from "@scout/research";
import { handleRequest } from "./http.ts";
import type { VoiceAi } from "./voice.ts";
import { sendOutbox } from "./push.ts";
import { resendSender, sendEmails, supabaseEmailStore } from "./email.ts";
import { DEFAULT_BATCH, notifyBudget, picksBatch, runDue } from "./run-due.ts";
import {
  dailyJobs,
  supabasePicksStore,
  supabasePushStore,
  supabaseQueue,
} from "./supabase.ts";

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
  // Brief emails (email.ts). All three set, or no emails are sent; even then
  // nothing goes out until the database's settings.email_on is set.
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string; // e.g. "Scout <briefs@your-verified-domain>"
  WORKER_URL?: string; // this Worker's origin, for the unsubscribe link
  // Workers AI ([ai] in wrangler.toml), for POST /voice. Free tier only.
  AI?: VoiceAi;
};

// Subrequests the email drain takes from the pushes' share each minute.
const EMAIL_BUDGET = 10;

// wrangler.toml's daily trigger.
export const DAILY_CRON = "17 3 * * *";

const worker = {
  async scheduled(controller: { cron?: string }, env: Env): Promise<void> {
    const supabase = {
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    };
    if (controller.cron === DAILY_CRON) {
      console.log("daily jobs", await dailyJobs(supabase));
      return;
    }

    const batchSize = Number(env.RUN_BATCH ?? DEFAULT_BATCH);
    const claude = anthropicClient({ apiKey: env.ANTHROPIC_API_KEY });
    const summary = await runDue({
      queue: supabaseQueue(supabase),
      claude,
      batchSize,
    });
    if (summary.claimed) console.log("run queue tick", summary);

    // Picks before pushes: a finished Monday refresh queues its weekly push.
    const picks = await createPicks({
      claude,
      store: supabasePicksStore(supabase),
    })
      .refresh(picksBatch(batchSize))
      .catch((err) => {
        console.error("[picks] refresh failed:", err);
        return null;
      });
    if (picks?.claimed) console.log("picks tick", picks);

    const emailSender =
      env.RESEND_API_KEY && env.EMAIL_FROM && env.WORKER_URL
        ? resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
        : null;
    const notify = notifyBudget(batchSize);
    const emailBudget = emailSender ? Math.min(EMAIL_BUDGET, notify) : 0;

    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      await sendOutbox({
        store: supabasePushStore(supabase),
        vapid: {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
        subject: env.VAPID_SUBJECT ?? "https://scout-ideas.pages.dev/",
        budget: notify - emailBudget,
      }).catch((err) => console.error("[push] outbox failed:", err));
    }

    await sendEmails({
      store: supabaseEmailStore(supabase),
      sender: emailSender,
      siteUrl: env.ALLOWED_ORIGIN.split(",")[0].trim(),
      workerUrl: env.WORKER_URL ?? "",
      signingKey: env.SUPABASE_SERVICE_ROLE_KEY,
      budget: emailBudget,
    }).catch((err) => console.error("[email] send failed:", err));
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
      ai: env.AI,
    });
  },
};

export default worker;
