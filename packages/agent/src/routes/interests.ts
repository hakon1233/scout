// /v0/interests — the interest list's three verbs (PER-274 split; behavior
// unchanged): GET rich list w/ doc metadata (PER-169), PUT persist-only save
// (PER-160), POST run+persist (the product's core "Run now" path). The
// validation + wipe-guard helpers live here because these routes are their
// only callers — both verbs must apply the exact same rules.

import {
  loadState,
  saveState,
  reconcileInterests,
  interestTopics,
  type State,
} from "../state.js";
import { interestDocMeta, readInterestDoc } from "../docs.js";
import { startRun } from "../runner.js";
import { json, jsonBodyParseError, parseJsonBody } from "../http-util.js";
import { MAX_INTEREST_LEN, MAX_INTERESTS } from "../limits.js";
import type { AuthedRequestContext, ServerContext } from "./types.js";

// The interest-count and per-interest-length bounds, plus the request-size cap
// they feed, all live in limits.ts so the arithmetic between them stays in one
// place. Re-exported here because server.ts and the routes import it from this
// module. (PER-137)
export { MAX_INTEREST_LEN, MAX_INTERESTS };

type InterestParse =
  | { ok: true; interests: string[] }
  | { ok: false; status: number; error: string };

// Clean → dedupe (case-insensitively, keeping first casing) → enforce the
// 1..MAX_INTERESTS count and per-interest length budget. Shared by POST /v0/interests
// (which also kicks a synthesis run) and PUT /v0/interests (persist-only,
// PER-160) so both apply the exact same rules. (Dedupe rationale: PER-126;
// length cap: PER-137.)
function parseInterestsPayload(raw: unknown): InterestParse {
  if (Array.isArray(raw) && raw.some((s) => typeof s !== "string")) {
    return {
      ok: false,
      status: 400,
      error: "interests must be strings",
    };
  }
  const cleaned = Array.isArray(raw)
    ? raw.map((s) => s.trim()).filter(Boolean)
    : [];
  const seen = new Set<string>();
  const interests = cleaned.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (interests.length === 0)
    return { ok: false, status: 400, error: "interests required" };
  if (interests.length > MAX_INTERESTS)
    return {
      ok: false,
      status: 400,
      error: `too many interests, max ${MAX_INTERESTS}`,
    };
  if (interests.some((s) => s.length > MAX_INTEREST_LEN))
    return {
      ok: false,
      status: 400,
      error: `interest too long, max ${MAX_INTEREST_LEN} chars`,
    };
  return { ok: true, interests };
}

// Wipe guard (PER-240): which currently-saved topics an incoming interests list
// would silently drop. Both interest writes (PUT persist-only, POST run+persist)
// are replace-all — a "safe-looking" subset payload from any authed client used
// to atomically destroy the founder's saved set (the 2026-06-11 incident: a
// one-topic QA payload wiped 5 real interests). A write that drops anything now
// requires an explicit `confirm_replace: true` token, mirroring the PER-230
// confirm-delete seam. Case-insensitive to match parseInterestsPayload's dedupe
// and reconcileInterests' id-preserving match.
function droppedTopics(
  saved: State["interests"],
  incoming: string[],
): string[] {
  const incomingKeys = new Set(incoming.map((s) => s.toLowerCase()));
  return interestTopics(saved).filter(
    (t) => !incomingKeys.has(t.toLowerCase()),
  );
}

// Shared 409 body for a guarded destructive replace. `dropped` tells the caller
// exactly what it was about to destroy; the hint names both intentional paths.
function wipeGuardError(dropped: string[]) {
  return {
    error: "replace would drop saved interests",
    dropped,
    hint: "This endpoint replaces the whole saved list. Pass confirm_replace:true to intentionally drop these, or ephemeral:true (POST only) for a test run that persists nothing.",
  };
}

// Rich interest list with per-interest intent-doc metadata (PER-169).
// Unlike /v0/config (which flattens to topic strings for back-compat),
// this is the authoritative shape the profile view consumes: each entry
// is {id, topic, hasDoc, docUpdatedAt}. `hasDoc`/`docUpdatedAt` are read
// straight from the doc store (docs.ts) so they can never drift from the
// actual `<id>.md` files. Field names match what C3/PER-170's
// fetchInterestDocMeta() already consumes, so the profile doc-indicator
// lights up on real data with no FE change.
export async function handleGetInterests(
  { res, cors, state }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const interests = state.interests ?? [];
  const withMeta = await Promise.all(
    interests.map(async (it) => {
      const [meta, doc] = await Promise.all([
        interestDocMeta(it.id, sc.interestsDir),
        readInterestDoc(it.id, sc.interestsDir),
      ]);
      return {
        id: it.id,
        topic: it.topic,
        hasDoc: meta.hasDoc,
        docUpdatedAt: meta.updatedAt ?? null,
        doc,
      };
    }),
  );
  json(res, 200, { interests: withMeta }, cors);
}

// Persist-only interests save (PER-160). The profile/edit view PUTs the
// user's interests so the edit sticks in state.json on its own —
// distinct from POST below, which ALSO kicks a (~5-min) synthesis run.
// The scheduler reuses whatever is persisted here on its next fire.
export async function handlePutInterests(
  { req, res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{
    interests?: unknown;
    confirm_replace?: unknown;
  }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;
  const validated = parseInterestsPayload(parsed.interests);
  if (!validated.ok)
    return json(res, validated.status, { error: validated.error }, cors);
  // Reload the state fresh AFTER the (network-bound) body read, and spread THIS
  // snapshot — not the auth-time `state` the router loaded before parseJsonBody.
  // A brief run, chat turn, or scheduler reschedule can complete during the body
  // read and write last_brief/briefs/last_chat/schedule; spreading the stale
  // auth-time snapshot would silently revert those concurrent writes (e.g. drop a
  // brief that just finished). Mirrors the reload-before-persist the runner
  // (runner.ts) and chat (chat.ts) paths already use. The remaining window (fresh
  // load → save, both below with no await between) is effectively zero (AIR-107).
  const fresh = await loadState(sc.stateFile);
  // Wipe guard (PER-240): PUT is replace-all, so a payload missing any
  // currently-saved topic is destructive. Refuse it unless the caller
  // explicitly confirms — additive edits (same set or supersets) pass
  // through untouched.
  const dropped = droppedTopics(fresh.interests, validated.interests);
  if (dropped.length > 0 && parsed.confirm_replace !== true) {
    return json(res, 409, wipeGuardError(dropped), cors);
  }
  // Persist the rich {id, topic} model, preserving each existing topic's
  // id so its intent doc stays attached across an edit (PER-169). The
  // wire response stays a topic string[] for back-compat.
  const interests = reconcileInterests(fresh.interests, validated.interests);
  await saveState({ ...fresh, interests }, sc.stateFile);
  json(res, 200, { interests: validated.interests, status: "saved" }, cors);
}

export async function handlePostInterests(
  { req, res, cors }: AuthedRequestContext,
  sc: ServerContext,
): Promise<void> {
  const parsedBody = await parseJsonBody<{
    interests?: unknown;
    retry_topics?: unknown;
    selected_topics?: unknown;
    ephemeral?: unknown;
    confirm_replace?: unknown;
  }>(req);
  if (!parsedBody.ok) return jsonBodyParseError(res, parsedBody, cors);
  const parsed = parsedBody.body;
  const validated = parseInterestsPayload(parsed.interests);
  if (!validated.ok)
    return json(res, validated.status, { error: validated.error }, cors);
  const topics = validated.interests;
  // Reload after the body read, matching PUT above. The router's auth-time
  // `state` may be stale by now if a chat turn, settings save, or another
  // companion write completed while the request body streamed in. The wipe
  // guard and rich-id reconciliation must use the latest snapshot so a normal
  // run never detaches intent docs from their current interest ids.
  const fresh = await loadState(sc.stateFile);

  // Ephemeral / dry-run trigger (PER-218): research the supplied topics
  // and produce a brief WITHOUT persisting them as the founder's saved
  // interests or touching the real intent-doc store. This is the path QA
  // and automation MUST use to fire test runs.
  const ephemeral = parsed.ephemeral === true;

  // Wipe guard (PER-240): a non-ephemeral POST persists its `interests`
  // body as the new saved list (replace-all). If that would drop any
  // currently-saved topic, refuse unless explicitly confirmed — this is
  // exactly the incident path (a one-topic test payload silently wiped
  // the founder's 5 saved interests). Ephemeral runs skip the guard
  // because they persist nothing.
  if (!ephemeral) {
    const dropped = droppedTopics(fresh.interests, topics);
    if (dropped.length > 0 && parsed.confirm_replace !== true) {
      return json(res, 409, wipeGuardError(dropped), cors);
    }
  }

  // Reconcile into the rich {id, topic} model (preserving ids) before the
  // run persists them, so the doc store stays anchored across runs.
  const interests = reconcileInterests(fresh.interests, topics);

  // Case-insensitively map a wire topic back to its canonical interest
  // casing, dropping anything not in the current list (no stale/foreign
  // topics). Shared by the retry and run-selector subsets below.
  const interestByKey = new Map(topics.map((s) => [s.toLowerCase(), s]));
  const intersectTopics = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? Array.from(
          new Set(
            (raw as unknown[])
              .filter((s): s is string => typeof s === "string")
              .map((s) => interestByKey.get(s.trim().toLowerCase()))
              .filter((s): s is string => Boolean(s)),
          ),
        )
      : [];

  // Optional focused-retry payload (PER-154): re-research ONLY these
  // topics and merge the fresh sections into the prior brief, instead of
  // regenerating the whole brief.
  const retryTopics = intersectTopics(parsed.retry_topics);

  // Optional run-selector payload (C6/PER-173): research ONLY this subset
  // and produce a FRESH brief over just those topics. The full interest
  // list is STILL persisted by startRun (the scheduler's source of
  // truth) — a partial run never shrinks the saved set. Ignored by the
  // runner when a retry is set or when it covers the whole list.
  const selectedTopics = intersectTopics(parsed.selected_topics);

  // One brief slot, last-writer-wins. The shared runner enforces single-
  // flight (in-memory guard + persisted pending check) so an on-demand
  // kick and a scheduled fire can never overlap (PER-151). It also
  // persists the interests so the scheduler can reuse them.
  const outcome = await startRun(
    interests,
    {
      stateFile: sc.stateFile,
      claudeBin: sc.claudeBin,
      spawnFn: sc.spawnFn,
      interestsDir: sc.interestsDir,
      onSynthesisDone: sc.onSynthesisDone,
    },
    "on_demand",
    { retryTopics, selectedTopics, ephemeral },
  );
  if (!outcome.started) {
    // A retry asked for but there's no prior brief to merge into → tell
    // the client to fall back to a full run rather than silently doing
    // nothing (no dead controls, PER-139/PER-154).
    if (outcome.reason === "no_base_brief") {
      return json(
        res,
        409,
        { error: "no base brief to retry; run a full brief first" },
        cors,
      );
    }
    // interests were validated non-empty above, so the only other reason
    // is a run already in flight → 409, echoing the in-flight id.
    const briefId =
      outcome.reason === "in_flight" ? outcome.briefId : undefined;
    return json(
      res,
      409,
      { error: "brief in progress", brief_id: briefId },
      cors,
    );
  }

  json(res, 202, { brief_id: outcome.briefId, status: "pending" }, cors);
}
