// What the setup chat knows about Scout itself, so it can answer "how do I…"
// questions, and the pages it may point the reader to. buildChatPrompt puts
// the guide in every chat prompt (hosted and companion). A reply may carry one
// `page`; only the paths in APP_PAGES survive parsing, so the model can never
// send the reader to an invented address.
//
// Keep the numbers in step with src/lib/plans.ts (src/lib/scout-guide.test.ts
// checks them) and the voice limit with supabase/migrations/*_voice.sql.

import type { AppPage } from "./contract.ts";

/** Pages the chat may offer to open, with the label the link shows. */
export const APP_PAGES: Record<AppPage, string> = {
  "/app/topics/": "Topics",
  "/app/browse/": "Browse",
  "/app/profile/": "Profile",
  "/app/settings/": "Settings",
  "/app/upgrade/": "Upgrade",
};

/** The page a model's `page` names, or undefined when it is not allowed. */
export function appPage(value: unknown): AppPage | undefined {
  if (typeof value !== "string") return undefined;
  return Object.hasOwn(APP_PAGES, value) ? (value as AppPage) : undefined;
}

export const SCOUT_GUIDE = `How Scout works (answer how-to questions from this only):
- Topics (/app/topics/): each topic is one thing Scout follows. Its intent doc says what the reader wants from it; this chat creates and refines topics. Each topic's ⋯ menu holds Schedule, sharing, Run now, Copy link and Delete.
- Schedule: Daily (a brief every morning), Weekly (Mondays) or Paused. Set it in the topic's ⋯ menu.
- Brief settings (length, how many stories, language) have no switch in the app yet. Say what you want and it goes into the topic's intent doc.
- Sharing, per topic in its ⋯ menu: Private (only you), Link only (anyone with the link can read it). Public means listed in Browse (/app/browse/); Scout makes a topic public only after it passes a publish check, and at most 3 of yours can be public. Browse is not open yet.
- Push and the bell: turn on notifications for this device in Settings, then press a topic's bell on Topics to get a push when its brief lands. Each topic is off until its bell is on.
- Settings (/app/settings/): appearance, notifications, time zone (daily briefs arrive in the morning there), your plan and what you have used, sign out, and Delete account (type DELETE to confirm; it removes everything).
- Profile (/app/profile/): your liked stories.
- Free plan: 15 topics (1 daily, 3 weekly), 3 Run now a day, 3 public topics, 5 voice messages a day. Plus (/app/upgrade/), 49 kr (about $5) a month: 30 topics (6 daily, 3 weekly), 3 Run now a day. Paying is not open yet.
- Sharing, Browse, notifications, plans and accounts exist only in signed-in Scout on the web.`;
