// The hosted app's data: the signed-in reader's interests, their latest brief,
// their plan's allowance, the setup chat, run-now and sharing (links, follows,
// and the notice when a host stops sharing), publishing and the catalog
// (browse, tags, reports), the reader's profile, likes and saves, and usage
// events. The one module hosted screens call; components never fetch or touch
// Supabase themselves. A share link (`shared`) and browse also work signed out.
//
// Reads and the reader's own edits go to Supabase's REST API as the reader
// (their JWT, so RLS and the quota trigger apply). The chat and run-now go to
// the Worker (packages/worker), which verifies the same JWT. Plain fetch: only
// auth.ts holds supabase-js. Errors reach callers as a HostedError whose
// message is written for the reader.
//
// The work lives in src/lib/hosted/, one module per area over one client
// (client.ts); this file composes them and is the only one callers import.

import { plural } from "@scout/core";
import { hostedAuth, hostedConfig } from "./auth";
import { accountData } from "./hosted/account";
import { catalogData } from "./hosted/catalog";
import { chatData } from "./hosted/chat";
import { hostedClient, type HostedDeps } from "./hosted/client";
import { homeData } from "./hosted/home";
import { likesSync, marksData, marksSync } from "./hosted/marks";
import { browserPushDevice, pushData } from "./hosted/push";
import { sharingData } from "./hosted/sharing";
import type { Allowance, HostedData } from "./hosted/types";
import { createFakeHostedData, fakeHostedOn } from "./hosted-fake";
import { followLikes, followSaves } from "./likes";

export * from "./hosted/types";
export type { HostedDeps } from "./hosted/client";
export { browserPushDevice, likesSync, marksSync };

export function createHostedData(deps: HostedDeps): HostedData {
  const c = hostedClient(deps);
  return {
    ...pushData(c),
    ...homeData(c),
    ...chatData(c),
    ...sharingData(c),
    ...catalogData(c),
    ...accountData(c),
    ...marksData(c),
  };
}

/** What the reader's plan has left, in one plain line. */
export function allowanceLine(a: Allowance): string {
  const left = (x: { used: number; limit: number }) =>
    Math.max(0, x.limit - x.used);
  const plan = a.plan.charAt(0).toUpperCase() + a.plan.slice(1);
  return (
    `${plan} plan: ${left(a.daily)} of ${a.daily.limit} daily and ` +
    `${left(a.weekly)} of ${a.weekly.limit} weekly slots free. ` +
    `${plural(left(a.runsToday), "run")} left today.`
  );
}

/** The page a share link opens: `/i/?s=<slug>`, under the app's base path. */
export function shareUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${base}/i/?s=${encodeURIComponent(slug)}`;
}

let hosted: HostedData | null | undefined;

/** The app's one HostedData, or null in a build without hosted config. */
export function hostedData(): HostedData | null {
  if (hosted !== undefined) return hosted;
  const config = hostedConfig();
  const auth = hostedAuth();
  if (!config || !auth) return (hosted = null);
  // The literal NODE_ENV test lets a production build drop the fake entirely.
  if (process.env.NODE_ENV !== "production" && fakeHostedOn())
    return (hosted = createFakeHostedData());
  hosted = createHostedData({
    supabaseUrl: config.url,
    anonKey: config.anonKey,
    workerUrl: (process.env.NEXT_PUBLIC_SCOUT_WORKER_URL ?? "").replace(
      /\/$/,
      "",
    ),
    session: async () => {
      const user = await auth.currentUser();
      const token = user ? await auth.accessToken() : null;
      return user && token ? { userId: user.id, accessToken: token } : null;
    },
    push: browserPushDevice(process.env.NEXT_PUBLIC_BASE_PATH ?? ""),
    vapidKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  });
  return hosted;
}

let likesFollowed = false;

/** Ties the likes and saves stores to the hosted session for this page load: the signed-in
 *  reader's likes come from the database, and sign-out or an account switch
 *  drops the previous reader's. Safe to call more than once. */
export function startHostedLikes(): void {
  if (likesFollowed) return;
  const auth = hostedAuth();
  const data = hostedData();
  if (!auth || !data) return;
  likesFollowed = true;
  followLikes(auth, likesSync(data));
  followSaves(auth, marksSync(data, "save"));
}
