// The trusted applier for chat: validates a model's proposed changes against
// the interests we hold, mints ids server-side, writes intent docs, and holds
// deletes and full rewrites back for the reader to confirm.

import type {
  ChatChange,
  Interest,
  PendingDelete,
  PendingRewrite,
} from "./contract.js";
import type { ProposedChange } from "./chat-model.js";
import {
  deleteInterestDoc,
  readInterestDoc,
  writeInterestDoc,
} from "./docs.js";
import { MAX_INTERESTS } from "./limits.js";
import { newInterestId } from "./state.js";

// Apply the model's proposed changes to the doc store + interest list, returning
// the new interest list and the change set that ACTUALLY landed (with concrete,
// server-assigned ids). Every change is validated against `current`: an update or
// delete naming an id we don't hold is dropped (so the model can never write an
// arbitrary `<id>.md`), and a create past MAX_INTERESTS is dropped. The applied
// list — never the model's raw proposal — is what we return to the client, so the
// FE only ever sees confirmed writes (PER-139).
//
// PER-230: delete is the one DESTRUCTIVE op, so it is confirm-gated. A model
// `delete` is NOT applied here; it is collected into `pendingDeletes` and surfaced
// to the FE as a [Delete]/[Cancel] proposal. The interest stays alive until the
// user explicitly confirms via applyConfirmedDelete. create/update remain
// auto-apply (CEO decision on PER-230 — do not gate those).
//
// PER-235: a full from-scratch `rewrite` replaces the ENTIRE doc, so it is gated
// the same way: collected into `pendingRewrites` (with the FULL proposed doc),
// NOT written. The doc on disk stays byte-identical until the user presses
// [Apply], which routes through applyConfirmedRewrite.
export async function applyChatChanges(
  current: Interest[],
  proposed: ProposedChange[],
  interestsDir: string,
): Promise<{
  interests: Interest[];
  applied: ChatChange[];
  pendingDeletes: PendingDelete[];
  pendingRewrites: PendingRewrite[];
}> {
  const interests = [...current];
  const applied: ChatChange[] = [];
  const pendingDeletes: PendingDelete[] = [];
  const pendingRewrites: PendingRewrite[] = [];

  for (const ch of proposed) {
    const op = ch.op;
    if (op === "create") {
      const topic = typeof ch.topic === "string" ? ch.topic.trim() : "";
      if (!topic) continue;
      if (interests.length >= MAX_INTERESTS) continue;
      const id = newInterestId();
      const doc = typeof ch.doc === "string" ? ch.doc : "";
      interests.push({ id, topic });
      await writeInterestDoc(id, doc, interestsDir);
      applied.push({ interestId: id, op: "create", topic, doc });
    } else if (op === "update") {
      const id = typeof ch.interestId === "string" ? ch.interestId : "";
      const idx = interests.findIndex((i) => i.id === id);
      if (idx === -1) continue; // never touch an id we don't own
      const topic =
        typeof ch.topic === "string" && ch.topic.trim()
          ? ch.topic.trim()
          : interests[idx].topic;
      const doc =
        typeof ch.doc === "string"
          ? ch.doc
          : ((await readInterestDoc(id, interestsDir)) ?? "");
      interests[idx] = { id, topic };
      await writeInterestDoc(id, doc, interestsDir);
      applied.push({ interestId: id, op: "update", topic, doc });
    } else if (op === "rewrite") {
      const id = typeof ch.interestId === "string" ? ch.interestId : "";
      const idx = interests.findIndex((i) => i.id === id);
      if (idx === -1) continue; // never touch an id we don't own
      const doc = typeof ch.doc === "string" ? ch.doc : "";
      if (!doc.trim()) continue; // a rewrite without a full doc is meaningless
      // Confirm-gated (PER-235): propose with the FULL doc, do NOT write. Dedup
      // so a model that lists the same id twice still surfaces one card.
      if (!pendingRewrites.some((p) => p.interestId === id)) {
        pendingRewrites.push({
          interestId: id,
          topic: interests[idx].topic,
          doc,
        });
      }
    } else if (op === "delete") {
      const id = typeof ch.interestId === "string" ? ch.interestId : "";
      const idx = interests.findIndex((i) => i.id === id);
      if (idx === -1) continue;
      // Confirm-gated: propose, do NOT remove. Dedup so a model that lists the
      // same id twice still surfaces one card.
      if (!pendingDeletes.some((p) => p.interestId === id)) {
        pendingDeletes.push({ interestId: id, topic: interests[idx].topic });
      }
    }
  }

  return { interests, applied, pendingDeletes, pendingRewrites };
}

// Perform a confirmed delete (PER-230): the deterministic removal that runs only
// after the user presses [Delete] on the confirm card. No model involved — we
// validate the id is one we hold, splice it out, and delete its doc. Returns the
// applied delete change (for the FE to render + flash) or null if the interest is
// already gone (a double-confirm or a stale card → 404 at the route).
export async function applyConfirmedDelete(
  current: Interest[],
  interestId: string,
  interestsDir: string,
): Promise<{ interests: Interest[]; applied: ChatChange | null }> {
  const interests = [...current];
  const idx = interests.findIndex((i) => i.id === interestId);
  if (idx === -1) return { interests, applied: null };
  const [removed] = interests.splice(idx, 1);
  await deleteInterestDoc(interestId, interestsDir);
  return {
    interests,
    applied: { interestId, op: "delete", topic: removed.topic },
  };
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
