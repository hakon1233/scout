// Pure state-transition seams extracted from useProfileWorkbench (CAR-248).
//
// Everything here is a plain function of its inputs — no React, no timers, no
// browser globals. The hook keeps ownership of effects, refs, and timers and
// delegates the actual state math to these helpers so the transitions can be
// reasoned about (and unit-tested) in isolation. Keep it that way: if a helper
// needs `window`, a timer, or a ref, it belongs in the hook, not here.

import type { ChatChange, ChatTurn } from "@/lib/chat";
import { type InterestDocMeta, interestKey } from "@/lib/interest-docs";
import type { Interest } from "@/lib/types";
import type { ChatMessage } from "./ChatDock";
import type { DocBeat, DocCardModel } from "./InterestDocCard";

// mergeInterests now lives in @/lib/interest-docs (single home; it was copied
// verbatim here and in the interest-scope page). Re-exported so existing
// importers of this helpers module keep working.
export { mergeInterests } from "@/lib/interest-docs";

// Monotonic chat-message id source. Module-scoped so ids stay unique across the
// seed messages and every live turn the hook appends.
let msgSeq = 0;
export function nextMsgId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

export function greetingMessage(): ChatMessage {
  return {
    id: nextMsgId(),
    role: "scout",
    text: "Hi — I'm Scout. Tell me what to track and I'll draft an intent doc for it, refine one you already have, or drop an interest. Pick “Refine” on any card to aim a message at it.",
  };
}

export function markdownDemoMessages(): ChatMessage[] {
  return [
    {
      id: nextMsgId(),
      role: "you",
      text: "Track **user emphasis** and keep `<script>xss()</script>` as inert text.",
      ts: "2026-06-05T12:00:00.000Z",
    },
    {
      id: nextMsgId(),
      role: "scout",
      text: [
        "## Scout markdown reply",
        "",
        "**assistant emphasis** and a [source link](https://example.com/brief).",
        "",
        "> quoted context",
        "",
        "```ts",
        'const topic = "markdown";',
        "```",
      ].join("\n"),
      ts: "2026-06-05T12:01:00.000Z",
    },
  ];
}

// Project a companion transcript into the flat you/scout message log the dock
// renders: each turn yields a `you` bubble, plus a `scout` bubble when the turn
// is ready with a reply/change/pending action, or a quiet failure bubble.
export function transcriptMessages(turns: ChatTurn[]): ChatMessage[] {
  return turns.flatMap((turn) => {
    const out: ChatMessage[] = [
      {
        id: nextMsgId(),
        role: "you",
        text: turn.message,
        ts: turn.created_at,
      },
    ];
    if (
      turn.status === "ready" &&
      (turn.reply ||
        (turn.changes && turn.changes.length > 0) ||
        turn.pending_delete ||
        turn.pending_rewrite)
    ) {
      out.push({
        id: nextMsgId(),
        role: "scout",
        text: turn.reply ?? "",
        ts: turn.created_at,
        changes:
          turn.changes && turn.changes.length > 0 ? turn.changes : undefined,
        pendingDelete: turn.pending_delete,
        pendingRewrite: turn.pending_rewrite,
      });
    } else if (turn.status === "failed" && turn.error_msg) {
      out.push({
        id: nextMsgId(),
        role: "scout",
        text: `I couldn't finish that turn: ${turn.error_msg}`,
        ts: turn.created_at,
        failed: true,
      });
    }
    return out;
  });
}

// Drop a key from a string-keyed record without mutating the input. Returns the
// same reference when the key is absent so React can bail out of a re-render.
export function dropKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

// Remove an interest by its stable key (matching either the derived key or the
// raw id). Mirrors the membership test used everywhere else in the workbench.
export function dropInterest(interests: Interest[], key: string): Interest[] {
  return interests.filter((i) => interestKey(i) !== key && i.id !== key);
}

// Apply one chat change to the interests array: delete removes; create/update
// upserts the (possibly renamed) topic, preserving an existing id. Pure — no
// doc-body/meta side effects (those are separate seams below).
export function applyInterestChange(
  prev: Interest[],
  ch: ChatChange,
): Interest[] {
  const key = ch.interestId;
  if (ch.op === "delete") return dropInterest(prev, key);
  const topic = ch.topic?.trim() ?? "";
  const idx = prev.findIndex((i) => interestKey(i) === key || i.id === key);
  if (idx === -1) return [...prev, { id: key, topic }];
  if (topic && prev[idx].topic !== topic) {
    const next = [...prev];
    next[idx] = { ...next[idx], id: prev[idx].id || key, topic };
    return next;
  }
  return prev;
}

// Apply one chat change to the doc-body store: delete removes the body; an
// update/create with a doc string writes it; otherwise the store is unchanged.
export function applyDocBodyChange(
  prev: Record<string, string>,
  ch: ChatChange,
): Record<string, string> {
  const key = ch.interestId;
  if (ch.op === "delete") return dropKey(prev, key);
  if (typeof ch.doc === "string") return { ...prev, [key]: ch.doc };
  return prev;
}

// Apply one chat change to the doc-meta store: delete removes the entry; any
// create/update marks the interest as having a doc, stamped at `at`.
export function applyDocMetaChange(
  prev: Record<string, InterestDocMeta>,
  ch: ChatChange,
  at: string,
): Record<string, InterestDocMeta> {
  const key = ch.interestId;
  if (ch.op === "delete") return dropKey(prev, key);
  return { ...prev, [key]: { hasDoc: true, updatedAt: at } };
}

// Resolve a confirmation card (or otherwise patch a single message) by id,
// leaving every other message untouched.
export function resolveMessage(
  messages: ChatMessage[],
  msgId: string,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m));
}

// Project the interest list + doc stores into the docs-rail card models. `meta`
// is already resolved by the caller (live meta or the mock-seed projection).
export function buildDocCards(
  interests: Interest[],
  meta: Record<string, InterestDocMeta>,
  docBodies: Record<string, string>,
  beats: Record<string, DocBeat>,
): DocCardModel[] {
  return interests.map((i) => {
    const key = interestKey(i);
    const m = meta[key] ?? { hasDoc: false };
    const body = docBodies[key];
    return {
      key,
      topic: i.topic,
      hasDoc: m.hasDoc || Boolean(body),
      updatedAt: m.updatedAt,
      body,
      beat: beats[key] ?? null,
      // Deep-links into the workbench itself (PER-236 fix 2) so a new-tab open
      // lands on the scope view WITH the chat column, not the chat-less
      // standalone page (which stays alive for old links).
      href: `/app/interests/?id=${encodeURIComponent(key)}`,
    };
  });
}
