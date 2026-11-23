// The one way the area modules reach Supabase and the Worker: the reader's
// session, REST calls as the reader (RLS and the quota trigger apply), and
// Worker calls with the same JWT. Every failure leaves here as a HostedError
// whose message is written for the reader.

import { plural, PUBLISH_PATH, quotaMessage } from "@scout/core";
import { HostedError, type PushDevice, type Session } from "./types";

type Fetch = typeof fetch;

export type HostedDeps = {
  supabaseUrl: string;
  anonKey: string;
  workerUrl: string;
  session: () => Promise<Session | null>;
  fetch?: Fetch;
  push?: PushDevice;
  vapidKey?: string; // the Worker's VAPID public key, base64url
};

export type HostedClient = ReturnType<typeof hostedClient>;

export function hostedClient(deps: HostedDeps) {
  const doFetch: Fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));

  async function session(): Promise<Session> {
    const s = await deps.session();
    if (!s) throw new HostedError("signed-out", "Sign in to see your briefs.");
    return s;
  }

  async function call(
    url: string,
    init: {
      method: string;
      body?: unknown;
      prefer?: string;
      keepalive?: boolean;
    },
    s: Session,
    apikey = true,
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${s.accessToken}`,
    };
    if (apikey) headers.apikey = deps.anonKey;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.prefer) headers.prefer = init.prefer;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        ...(init.keepalive ? { keepalive: true } : {}),
      });
    } catch {
      throw new HostedError(
        "failed",
        apikey
          ? "Scout can't be reached. Check your connection and try again."
          : "Scout's server can't be reached right now. Try again later.",
      );
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (res.status === 401)
      throw new HostedError("signed-out", "Your session ended. Sign in again.");
    return { status: res.status, body };
  }

  async function rest<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      prefer?: string;
      // Lets the request finish after the page is gone (usage on pagehide).
      keepalive?: boolean;
    } = {},
    // Signed out, the anon key stands in for the session (public reads only).
    signedOutOk = false,
  ): Promise<T> {
    const s = signedOutOk
      ? ((await deps.session()) ?? { userId: "", accessToken: deps.anonKey })
      : await session();
    const { status, body } = await call(
      `${deps.supabaseUrl}/rest/v1/${path}`,
      {
        method: init.method ?? "GET",
        body: init.body,
        prefer: init.prefer,
        keepalive: init.keepalive,
      },
      s,
    );
    if (status >= 400) throw restError(body);
    return body as T;
  }

  async function worker(path: string, payload: unknown): Promise<unknown> {
    if (!deps.workerUrl)
      throw new HostedError("failed", "This build has no Scout server set up.");
    const s = await session();
    const { status, body } = await call(
      `${deps.workerUrl}${path}`,
      { method: "POST", body: payload },
      s,
      false,
    );
    if (status < 400) return body;
    const b = body as { error?: string; message?: string } | null;
    const said = b?.message ?? b?.error ?? "";
    if (status === 429)
      throw new HostedError("limit", workerLimitMessage(path, said));
    // The publish route's other refusals are written for the reader.
    if (path === PUBLISH_PATH && said && status !== 502)
      throw new HostedError("failed", said);
    // The Mac's gateway when its `claude` could not answer (local accounts).
    if (status === 503 && said) throw new HostedError("failed", said);
    if (status === 409)
      throw new HostedError(
        "failed",
        "That was already settled. Send a new message.",
      );
    throw new HostedError("failed", "Something went wrong. Try again.");
  }

  async function patchInterest(id: string, fields: Record<string, unknown>) {
    await rest(`interests?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: fields,
      prefer: "return=minimal",
    });
  }

  return { deps, doFetch, session, rest, worker, patchInterest };
}

// PostgREST's error body: the quota trigger raises P0001 with the limit's name
// as the hint (core's quotaMessage words it); the sharing calls raise P0002 for
// a link or notice that is gone.
function restError(body: unknown): HostedError {
  const err = (body ?? {}) as {
    code?: string;
    hint?: string;
    message?: string;
  };
  const limit = quotaMessage(err);
  if (limit) return new HostedError("limit", limit);
  if (err.code === "P0002")
    return new HostedError(
      "failed",
      "That's no longer shared. Ask whoever sent it for a new link.",
    );
  return new HostedError("failed", "Couldn't save that. Try again.");
}

function workerLimitMessage(path: string, said: string): string {
  if (path === "/runs") {
    const limit = /of (\d+)/.exec(said)?.[1];
    return `You've used today's ${plural(limit, "run")}. Scheduled briefs still come.`;
  }
  // The chat's refusals are already written for the reader (chat_block_reason).
  return said || "Scout has paused new work for now. Try again later.";
}
