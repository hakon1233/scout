// Notifications: this device's push subscription ("Notify me when a brief
// is ready") and the per-topic switch, plus the browser's push side.

import type { HostedClient } from "./client";
import {
  HostedError,
  type HostedData,
  type PushDevice,
  type PushKeys,
  type PushState,
} from "./types";

export function pushData(
  c: HostedClient,
): Pick<
  HostedData,
  "pushStatus" | "pushEnable" | "pushDisable" | "topicPush" | "setTopicPush"
> {
  const { deps, session, rest } = c;
  async function pushStatus(): Promise<PushState> {
    const p = deps.push;
    if (!p || !deps.vapidKey) return "unsupported";
    if (!p.supported) return p.needsInstall ? "needs-install" : "unsupported";
    if (p.permission() === "denied") return "denied";
    return (await p.subscription()) ? "on" : "off";
  }
  return {
    pushStatus,

    async pushEnable() {
      const p = deps.push;
      const key = deps.vapidKey;
      if (!p || !key || !p.supported) return pushStatus();
      // Nothing awaited before the prompt: Safari asks only within the tap.
      const granted =
        p.permission() === "granted" ||
        (await p.requestPermission()) === "granted";
      if (!granted) return pushStatus();
      let keys: PushKeys;
      try {
        keys = await p.subscribe(key);
      } catch {
        throw new HostedError(
          "failed",
          "This browser wouldn't turn on notifications. Try again.",
        );
      }
      try {
        await rest("rpc/save_push_subscription", {
          method: "POST",
          body: {
            p_endpoint: keys.endpoint,
            p_p256dh: keys.p256dh,
            p_auth: keys.auth,
          },
        });
      } catch (e) {
        await p.unsubscribe().catch(() => null);
        throw e;
      }
      return "on";
    },

    async pushDisable() {
      const p = deps.push;
      const endpoint = p ? await p.unsubscribe() : null;
      if (endpoint && (await deps.session())) {
        await rest(
          `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
          { method: "DELETE", prefer: "return=minimal" },
        );
      }
      return pushStatus();
    },

    async topicPush() {
      const s = await session();
      const user = encodeURIComponent(s.userId);
      const [own, follows] = await Promise.all([
        rest<{ id: string }[]>(
          `interests?select=id&owner_id=eq.${user}&deleted_at=is.null&push_enabled=is.true`,
        ),
        rest<{ interest_id: string }[]>(
          `follows?select=interest_id&user_id=eq.${user}&push_enabled=is.true`,
        ),
      ]);
      return [...own.map((r) => r.id), ...follows.map((r) => r.interest_id)];
    },

    async setTopicPush(interestId, on) {
      await rest("rpc/set_topic_push", {
        method: "POST",
        body: { p_interest: interestId, p_on: on },
      });
    },
  };
}

/** This browser's push side. The service worker (public/sw.js) shows the
 *  pushes; it is registered only when the reader turns notifications on. */
export function browserPushDevice(base: string): PushDevice | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = `${base}/`;
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios =
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const installed =
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  const keysOf = (sub: PushSubscription | null): PushKeys | null => {
    const json = sub?.toJSON();
    return json?.endpoint && json.keys?.p256dh && json.keys.auth
      ? {
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        }
      : null;
  };
  const current = async () =>
    (await navigator.serviceWorker.getRegistration(scope)) ?? null;
  return {
    supported:
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    needsInstall: ios && !installed,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async subscription() {
      const reg = await current();
      return reg ? keysOf(await reg.pushManager.getSubscription()) : null;
    },
    async subscribe(key) {
      await navigator.serviceWorker.register(`${base}/sw.js`, { scope });
      const reg = await navigator.serviceWorker.ready;
      const keys = keysOf(
        await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64urlBytes(key),
        }),
      );
      if (!keys) throw new Error("subscription without keys");
      return keys;
    },
    async unsubscribe() {
      const sub = await (await current())?.pushManager.getSubscription();
      if (!sub) return null;
      await sub.unsubscribe();
      return sub.endpoint;
    },
  };
}

function base64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
