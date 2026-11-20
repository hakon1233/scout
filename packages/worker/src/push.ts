// "Your brief is ready": a Web Push to every device of a ready run's readers
// (the interest's owner and followers). Host-neutral; the store and fetch are
// injected. Payloads are encrypted (RFC 8291, aes128gcm, which Apple requires)
// and signed (VAPID, RFC 8292) with Web Crypto by @block65/webcrypto-web-push,
// which runs on Workers (the node web-push library does not).
//
// Best effort by design: runDue swallows any failure here, so a push never
// fails or retries a run. A device the push service no longer knows (404 or
// 410) is deleted; any other failure is left for the next brief.

import { buildPushPayload } from "@block65/webcrypto-web-push";

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
  topic: string; // the interest's topic, for the notification's text
};

// The store seam. Adapter: supabasePushStore (supabase.ts).
export interface PushStore {
  // The devices to tell that a run is ready; none unless it is ready.
  targets(runId: string): Promise<PushTarget[]>;
  // Deletes devices the push service said are gone.
  drop(endpoints: string[]): Promise<void>;
}

// How long a push service keeps an undelivered push.
const TTL_SECONDS = 12 * 60 * 60;

/** What the service worker shows (public/sw.js). */
export function briefReadyPayload(topic: string) {
  return { title: "Your brief is ready", body: `New stories on ${topic}.` };
}

/**
 * The notify step of a tick. `budget` is how many subrequests it may make in
 * all, across runs (the Workers free plan allows 50 per invocation, and the
 * research uses most of them); each targets lookup, push and delete takes one.
 */
export function briefReadyNotifier(opts: {
  store: PushStore;
  // The VAPID key pair, base64url: the public key as its raw 65-byte point
  // (the web app's applicationServerKey), the private key as its JWK `d`.
  vapid: { publicKey: string; privateKey: string };
  subject: string; // the VAPID contact: an https: URL or mailto:
  fetch?: typeof fetch;
  budget?: number;
}): (runId: string) => Promise<void> {
  const doFetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  let left = opts.budget ?? Infinity;

  return async (runId) => {
    if (left < 2) return;
    left--;
    const targets = await opts.store.targets(runId);
    const gone: string[] = [];
    await Promise.all(
      targets.map(async (t) => {
        if (left < 1) return;
        left--;
        try {
          const req = await buildPushPayload(
            {
              data: briefReadyPayload(t.topic),
              options: { ttl: TTL_SECONDS, urgency: "normal" },
            },
            {
              endpoint: t.endpoint,
              expirationTime: null,
              keys: { p256dh: t.p256dh, auth: t.auth },
            },
            { ...opts.vapid, subject: opts.subject },
          );
          const res = await doFetch(t.endpoint, {
            method: "POST",
            headers: req.headers,
            body: req.body,
          });
          if (res.status === 404 || res.status === 410) gone.push(t.endpoint);
        } catch {
          // A bad subscription or a network error: try again next brief.
        }
      }),
    );
    if (gone.length && left >= 1) {
      left--;
      await opts.store.drop(gone);
    }
  };
}
