// Web Push from the outbox. finish_run queues a "Your brief is ready" row per
// device of a covered run's readers (the owner and followers who turned push on
// for that topic); queue_weekly_pushes queues one weekly digest per device on
// Mondays. Each tick sends a few rows with what the runs left of the
// subrequest budget. Host-neutral; the store and fetch are injected. Payloads
// are encrypted (RFC 8291, aes128gcm, which Apple requires) and signed (VAPID,
// RFC 8292) with Web Crypto by @block65/webcrypto-web-push, which runs on
// Workers (the node web-push library does not).
//
// Best effort by design: a claimed row is gone, sent or not. A device the push
// service no longer knows (404 or 410) is deleted.

import { buildPushPayload } from "@block65/webcrypto-web-push";

// One queued push, joined to its device.
export type OutboxPush = {
  endpoint: string;
  p256dh: string;
  auth: string;
} & (
  | { kind: "push"; payload: { run_id: string; topic: string } }
  | {
      kind: "weekly";
      payload: {
        count: number;
        topics: string[];
        popular: { title: string; slug: string }[];
      };
    }
);

// The store seam. Adapter: supabasePushStore (supabase.ts).
export interface PushStore {
  // Takes up to `limit` queued pushes off the outbox, oldest first.
  claim(limit: number): Promise<OutboxPush[]>;
  // Deletes devices the push service said are gone.
  drop(endpoints: string[]): Promise<void>;
}

// How long a push service keeps an undelivered push.
const TTL_SECONDS = 12 * 60 * 60;

/** What the service worker shows (public/sw.js). */
export function briefReadyPayload(topic: string) {
  return { title: "Your brief is ready", body: `New stories on ${topic}.` };
}

/** The Monday digest: new stories in topics with push off, and popular ones. */
export function weeklyPayload(p: {
  count: number;
  topics: string[];
  popular: { title: string }[];
}) {
  const more =
    p.count > p.topics.length ? ` and ${p.count - p.topics.length} more` : "";
  const popular = p.popular.length
    ? ` Popular now: ${p.popular.map((t) => t.title).join(", ")}.`
    : "";
  return {
    title: "New this week in your topics",
    body: `New stories on ${p.topics.join(", ")}${more}.${popular}`,
  };
}

function payloadFor(item: OutboxPush) {
  return item.kind === "weekly"
    ? weeklyPayload(item.payload)
    : briefReadyPayload(item.payload.topic);
}

/**
 * Sends queued pushes within `budget` subrequests (the Workers free plan allows
 * 50 per invocation, and the runs use most of them): one for the claim, one per
 * push, one to delete gone devices. Returns how many were sent.
 */
export async function sendOutbox(opts: {
  store: PushStore;
  // The VAPID key pair, base64url: the public key as its raw 65-byte point
  // (the web app's applicationServerKey), the private key as its JWK `d`.
  vapid: { publicKey: string; privateKey: string };
  subject: string; // the VAPID contact: an https: URL or mailto:
  budget: number;
  fetch?: typeof fetch;
}): Promise<number> {
  const doFetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  const room = Math.floor(opts.budget) - 2;
  if (room < 1) return 0;
  const items = await opts.store.claim(room);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    items.map(async (item) => {
      try {
        const req = await buildPushPayload(
          {
            data: payloadFor(item),
            options: { ttl: TTL_SECONDS, urgency: "normal" },
          },
          {
            endpoint: item.endpoint,
            expirationTime: null,
            keys: { p256dh: item.p256dh, auth: item.auth },
          },
          { ...opts.vapid, subject: opts.subject },
        );
        const res = await doFetch(item.endpoint, {
          method: "POST",
          headers: req.headers,
          body: req.body,
        });
        if (res.status === 404 || res.status === 410) gone.push(item.endpoint);
        else if (res.ok) sent++;
      } catch {
        // A bad subscription or a network error: this push is dropped.
      }
    }),
  );
  if (gone.length) await opts.store.drop(gone);
  return sent;
}
