// The companion's side of the chat change set: core's planChatChanges decides
// what of a model's proposal lands (the same rules the hosted chat uses); this
// module mints ids and writes the intent docs of what landed.

import { planChatChanges, type Interest, type ProposedChange } from "#core";
import type { ChatChange, PendingDelete, PendingRewrite } from "#core";
import { buildInterestSnapshots } from "./chat-model.js";
import { deleteInterestDoc, writeInterestDoc } from "./docs.js";
import { MAX_INTEREST_LEN, MAX_INTERESTS } from "./limits.js";
import { newInterestId } from "./state.js";

// Apply the model's proposed changes to the doc store + interest list, returning
// the new interest list and the change set that ACTUALLY landed (with concrete,
// server-assigned ids). The rules live in core's planChatChanges: an id we don't
// hold is dropped, a create past MAX_INTERESTS is dropped, and deletes and full
// rewrites come back pending for the reader to confirm (applyConfirmedDelete,
// confirmRewriteTurn). Only the applied creates and updates are written here.
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
  const plan = planChatChanges(
    await buildInterestSnapshots(current, interestsDir),
    proposed,
    {
      newId: newInterestId,
      maxInterests: MAX_INTERESTS,
      maxTopicLen: MAX_INTEREST_LEN,
    },
  );
  for (const change of plan.applied) {
    await writeInterestDoc(change.interestId, change.doc ?? "", interestsDir);
  }
  return {
    interests: plan.interests.map(({ id, topic }) => ({ id, topic })),
    applied: plan.applied,
    pendingDeletes: plan.pendingDeletes,
    pendingRewrites: plan.pendingRewrites,
  };
}

// Perform a confirmed delete: the deterministic removal that runs only
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
