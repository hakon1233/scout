// The trusted rules for a chat turn's change set: which of the model's
// proposed changes land, which wait for the reader's confirm, and which are
// dropped. Pure: the caller mints ids and writes whatever lands, so the
// companion (files) and the hosted chat (a database) share one set of rules.

import type {
  ChatChange,
  Interest,
  PendingDelete,
  PendingFollow,
  PendingRewrite,
} from "./contract.ts";

// One change as the model proposed it. Every field is untrusted, so each is
// `unknown` until the planner checks it. `interestId` is omitted on create
// (the system mints it).
export type ProposedChange = {
  op?: unknown;
  interestId?: unknown;
  topic?: unknown;
  doc?: unknown;
};

// An interest with its current intent doc, as the model and the planner see it.
export type InterestSnapshot = { id: string; topic: string; doc: string };

export type ChatChangeLimits = {
  maxInterests: number;
  maxTopicLen: number;
  // A longer doc is dropped, not cut: half an intent doc would mislead the
  // next run. Absent: no limit.
  maxDocChars?: number;
};

export type ChatChangePlan = {
  // The reader's interests with the applied changes in place.
  interests: InterestSnapshot[];
  // Creates and updates, which apply at once. Ids are concrete (minted for a
  // create).
  applied: ChatChange[];
  // Deletes, full rewrites and follows, which wait for the reader's confirm.
  pendingDeletes: PendingDelete[];
  pendingRewrites: PendingRewrite[];
  pendingFollows: PendingFollow[];
};

// Decide what of a model's proposal lands. Every change is checked against
// `current`: an update, rewrite or delete naming an id the reader doesn't hold
// is dropped, so the model can never touch an interest that isn't theirs; a
// create past the cap is dropped. A follow must name one of the
// `publicInterests` the prompt offered. Deletes and full rewrites are
// destructive, so they are never applied here: they come back as pending,
// one per interest, for the reader to confirm. Creates and updates apply at
// once by design; do not gate those.
export function planChatChanges(
  current: InterestSnapshot[],
  proposed: ProposedChange[],
  opts: ChatChangeLimits & {
    newId: () => string;
    publicInterests?: Interest[];
  },
): ChatChangePlan {
  const interests = current.map((i) => ({ ...i }));
  const plan: ChatChangePlan = {
    interests,
    applied: [],
    pendingDeletes: [],
    pendingRewrites: [],
    pendingFollows: [],
  };
  const topicOf = (raw: unknown) =>
    typeof raw === "string" ? raw.trim().slice(0, opts.maxTopicLen) : "";
  const docFits = (doc: string) =>
    opts.maxDocChars === undefined || doc.length <= opts.maxDocChars;

  for (const ch of proposed) {
    const id = typeof ch.interestId === "string" ? ch.interestId : "";
    const doc = typeof ch.doc === "string" ? ch.doc : undefined;
    const held = interests.find((i) => i.id === id);
    if (ch.op === "create") {
      const topic = topicOf(ch.topic);
      if (!topic || interests.length >= opts.maxInterests) continue;
      if (!docFits(doc ?? "")) continue;
      const created = { id: opts.newId(), topic, doc: doc ?? "" };
      interests.push(created);
      plan.applied.push({
        interestId: created.id,
        op: "create",
        topic,
        doc: created.doc,
      });
    } else if (ch.op === "update") {
      if (!held) continue;
      if (doc !== undefined && !docFits(doc)) continue;
      held.topic = topicOf(ch.topic) || held.topic;
      if (doc !== undefined) held.doc = doc;
      plan.applied.push({
        interestId: id,
        op: "update",
        topic: held.topic,
        doc: held.doc,
      });
    } else if (ch.op === "rewrite") {
      // A rewrite without a full doc is meaningless.
      if (!held || !doc?.trim() || !docFits(doc)) continue;
      if (!plan.pendingRewrites.some((p) => p.interestId === id)) {
        plan.pendingRewrites.push({ interestId: id, topic: held.topic, doc });
      }
    } else if (ch.op === "delete") {
      if (!held) continue;
      if (!plan.pendingDeletes.some((p) => p.interestId === id)) {
        plan.pendingDeletes.push({ interestId: id, topic: held.topic });
      }
    } else if (ch.op === "follow") {
      const offered = opts.publicInterests?.find((p) => p.id === id);
      if (!offered || held) continue;
      if (!plan.pendingFollows.some((p) => p.interestId === id)) {
        plan.pendingFollows.push({ interestId: id, topic: offered.topic });
      }
    }
  }
  return plan;
}

// Apply an already-applied change set to another copy of the interest list,
// such as the one on disk at save time.
export function replayChanges(
  list: Interest[],
  changes: ChatChange[],
): Interest[] {
  let next = [...list];
  for (const c of changes) {
    const at = next.findIndex((i) => i.id === c.interestId);
    if (c.op === "create" && at === -1 && c.topic) {
      next.push({ id: c.interestId, topic: c.topic });
    } else if (c.op === "update" && at !== -1 && c.topic) {
      next[at] = { ...next[at], topic: c.topic };
    } else if (c.op === "delete") {
      next = next.filter((i) => i.id !== c.interestId);
    }
  }
  return next;
}
