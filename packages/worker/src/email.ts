// Brief emails: a topic's new brief in the inbox of each reader who turned on
// "Email me new briefs" for it. The queue is SQL's (*_email.sql): a ready run
// with stories queues one row per opted-in reader, only while
// `settings.email_on` is set. This module claims rows, holds each reader to
// DAILY_EMAIL_CAP emails in 24 hours, renders the brief, sends it through the
// EmailSender seam and marks what it sent. It also serves the one-click
// unsubscribe link, signed so no sign-in is needed.
//
// Off three ways, each enough: `settings.email_on` false (claim answers null),
// no sender (no RESEND_API_KEY: it logs once and claims nothing), or no rows.
// Best effort like pushes: a claimed row that fails to send is dropped.
// Host-neutral; the store, sender and fetch are injected.

import { rpcCaller } from "./supabase.ts";

export const DAILY_EMAIL_CAP = 20;
export const UNSUBSCRIBE_PATH = "/email/unsubscribe";

// One queued email, as claim_emails returns it.
export type QueuedEmail = {
  id: number;
  userId: string;
  to: string; // from auth.users only
  interestId: string;
  topic: string;
  sectionMd: string;
  // Emails this reader was sent in the last 24 hours, before this batch.
  sentToday: number;
};

// The store seam. Adapter: supabaseEmailStore (below).
export interface EmailStore {
  // Takes up to `limit` queued emails, oldest first; null while email is
  // switched off.
  claim(limit: number): Promise<QueuedEmail[] | null>;
  // Marks claimed emails as sent; they count toward the cap.
  sent(ids: number[]): Promise<void>;
  // Turns one reader's email off for one topic. Returns the topic, or null
  // when the reader neither owns nor follows it.
  unsubscribe(userId: string, interestId: string): Promise<string | null>;
}

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

// The sender seam. Adapter: resendSender (below). Throws when not sent.
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

type Fetch = typeof fetch;

/** Resend over fetch (https://resend.com/docs/api-reference/emails/send-email). */
export function resendSender(opts: {
  apiKey: string;
  from: string;
  fetch?: Fetch;
}): EmailSender {
  const doFetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  return {
    async send(m) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          headers: m.headers,
        }),
      });
      if (!res.ok) {
        throw new Error(
          `resend ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
    },
  };
}

/** The store over PostgREST with the service key. */
export function supabaseEmailStore(opts: {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
}): EmailStore {
  const rpc = rpcCaller(
    opts.url,
    opts.fetch ?? ((...a) => globalThis.fetch(...a)),
  );
  const auth = { apikey: opts.serviceKey, bearer: opts.serviceKey };
  type Row = {
    id: number;
    user_id: string;
    to: string;
    interest_id: string;
    topic: string;
    section_md: string | null;
    sent_today: number;
  };
  return {
    async claim(limit) {
      const rows = (await rpc("claim_emails", { p_limit: limit }, auth)) as
        | Row[]
        | null;
      return (
        rows?.map((r) => ({
          id: r.id,
          userId: r.user_id,
          to: r.to,
          interestId: r.interest_id,
          topic: r.topic,
          sectionMd: r.section_md ?? "",
          sentToday: Number(r.sent_today) || 0,
        })) ?? null
      );
    },
    async sent(ids) {
      await rpc("emails_sent", { p_ids: ids }, auth);
    },
    async unsubscribe(userId, interestId) {
      return (await rpc(
        "email_unsubscribe",
        { p_user: userId, p_interest: interestId },
        auth,
      )) as string | null;
    },
  };
}

let warnedNoSender = false;

/**
 * Sends queued emails within `budget` subrequests: one for the claim, one to
 * mark them sent, one per email. Returns how many were sent.
 */
export async function sendEmails(opts: {
  store: EmailStore;
  sender: EmailSender | null;
  siteUrl: string; // the web app's origin, for the link to the topic
  workerUrl: string; // this Worker's origin, for the unsubscribe link
  signingKey: string; // signs unsubscribe links
  budget: number;
  cap?: number;
  log?: (line: string) => void;
}): Promise<number> {
  const log = opts.log ?? ((line) => console.warn(line));
  if (!opts.sender) {
    if (!warnedNoSender) {
      warnedNoSender = true;
      log(
        "[email] RESEND_API_KEY, EMAIL_FROM or WORKER_URL unset: no emails sent",
      );
    }
    return 0;
  }
  const room = Math.floor(opts.budget) - 2;
  if (room < 1) return 0;
  const items = await opts.store.claim(room);
  if (!items?.length) return 0;

  const cap = opts.cap ?? DAILY_EMAIL_CAP;
  const count = new Map<string, number>();
  const due = items.filter((e) => {
    const n = Math.max(count.get(e.userId) ?? 0, e.sentToday);
    if (n >= cap) {
      count.set(e.userId, n);
      return false;
    }
    count.set(e.userId, n + 1);
    return true;
  });

  const sender = opts.sender;
  const results = await Promise.all(
    due.map(async (e) => {
      try {
        const unsubscribe = await unsubscribeUrl(
          opts.workerUrl,
          opts.signingKey,
          e.userId,
          e.interestId,
        );
        const m = briefEmail({
          topic: e.topic,
          sectionMd: e.sectionMd,
          topicUrl: `${trimSlash(opts.siteUrl)}/app/topics/?id=${encodeURIComponent(e.interestId)}`,
          unsubscribeUrl: unsubscribe,
        });
        await sender.send({ to: e.to, ...m });
        return e.id;
      } catch (err) {
        log(`[email] not sent: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );
  const sent = results.filter((id): id is number => id !== null);
  if (sent.length) await opts.store.sent(sent);
  return sent.length;
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

/** One brief as an email: subject, simple HTML and a plain-text part. */
export function briefEmail(p: {
  topic: string;
  sectionMd: string;
  topicUrl: string;
  unsubscribeUrl: string;
}): Omit<EmailMessage, "to"> {
  const stop = `Stop emails about ${p.topic}`;
  const html = [
    "<!doctype html>",
    "<html><body style=\"margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif\">",
    '<div style="max-width:600px;margin:0 auto">',
    markdownToHtml(p.sectionMd),
    `<p style="margin-top:24px"><a href="${attr(p.topicUrl)}">Read it in Scout</a></p>`,
    `<p style="margin-top:32px;font-size:13px;color:#666">You get this because you turned on email for ${escapeHtml(p.topic)} in Scout. <a href="${attr(p.unsubscribeUrl)}" style="color:#666">${escapeHtml(stop)}</a></p>`,
    "</div></body></html>",
  ].join("\n");
  const text = [
    markdownToText(p.sectionMd),
    "",
    `Read it in Scout: ${p.topicUrl}`,
    "",
    `${stop}: ${p.unsubscribeUrl}`,
  ].join("\n");
  return {
    subject: `New brief: ${p.topic}`,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${p.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

const IMAGE = /!\[[^\]]*\]\([^)\s]*\)/g;
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
const attr = escapeHtml;

// Escapes everything, then allows only links (http and https), bold and
// inline code shown as plain text.
function inline(s: string): string {
  return escapeHtml(s.replace(IMAGE, ""))
    .replace(
      LINK,
      (_, label: string, url: string) => `<a href="${url}">${label}</a>`,
    )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "$1");
}

/** The brief's markdown (core's brief grammar) as simple HTML: headings and paragraphs. */
function markdownToHtml(md: string): string {
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim().replace(IMAGE, "").trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) {
      out.push(`<h2>${inline(m[1])}</h2>`);
    } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      out.push(`<p style="margin:16px 0 4px">${inline(m[1])}</p>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      if (m[1].trim())
        out.push(`<p style="margin:4px 0;color:#444">${inline(m[1])}</p>`);
    } else {
      out.push(`<p style="margin:4px 0">${inline(line)}</p>`);
    }
  }
  return out.join("\n");
}

function markdownToText(md: string): string {
  return md
    .split("\n")
    .map((l) =>
      l
        .replace(IMAGE, "")
        .replace(LINK, "$1 ($2)")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^(\s*)>\s?/, "$1")
        .replace(/^#{1,6}\s+/, "")
        .trimEnd(),
    )
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
    .join("\n")
    .trim();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const signed = (userId: string, interestId: string) =>
  new TextEncoder().encode(
    `email-unsubscribe:v1:${userId.toLowerCase()}:${interestId.toLowerCase()}`,
  );

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The signed one-click unsubscribe link for one reader and one topic. */
export async function unsubscribeUrl(
  workerUrl: string,
  signingKey: string,
  userId: string,
  interestId: string,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(signingKey),
    signed(userId, interestId),
  );
  const q = new URLSearchParams({
    u: userId,
    i: interestId,
    t: base64url(new Uint8Array(sig)),
  });
  return `${trimSlash(workerUrl)}${UNSUBSCRIBE_PATH}?${q}`;
}

function page(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
      `<body style="margin:0;padding:32px 16px;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a"><div style="max-width:480px;margin:0 auto"><h1 style="font-size:22px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * GET (the link) or POST (the mail app's one-click, RFC 8058) on
 * UNSUBSCRIBE_PATH: checks the signature and turns that topic's email off.
 */
export async function handleUnsubscribe(
  request: Request,
  deps: { store: EmailStore; signingKey: string },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  }
  const q = new URL(request.url).searchParams;
  const userId = q.get("u") ?? "";
  const interestId = q.get("i") ?? "";
  const sig = fromBase64url(q.get("t") ?? "");
  const valid =
    UUID.test(userId) &&
    UUID.test(interestId) &&
    sig !== null &&
    (await crypto.subtle.verify(
      "HMAC",
      await hmacKey(deps.signingKey),
      sig,
      signed(userId, interestId),
    ));
  if (!valid) {
    return page(
      400,
      "This link doesn't work",
      "Turn email off for a topic in Scout's Settings instead.",
    );
  }
  let topic: string | null;
  try {
    topic = await deps.store.unsubscribe(userId, interestId);
  } catch {
    return page(502, "Something went wrong", "Try the link again in a minute.");
  }
  return topic === null
    ? page(
        200,
        "Nothing to turn off",
        "You no longer have this topic in Scout.",
      )
    : page(
        200,
        "Emails turned off",
        `You won't get emails about ${topic} any more. Turn them back on in Scout's Settings.`,
      );
}
