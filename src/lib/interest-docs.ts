"use client";

import { PATHS, type Interest } from "@scout/agent/contract";
import { companionFetch, fetchCompanionInterests } from "./companion";
import { isClient } from "./safe-storage";

// Per-interest "intent doc" metadata. The intent doc is the
// chat-managed markdown that steers an interest's research session; this module
// only carries the *metadata* the profile landing needs — whether a doc exists
// and when it last changed — not the doc body itself (that's the doc editor).
//
// The metadata comes from the companion's GET /v0/interests. When that answer
// carries none, every interest reads as "no doc" — never inventing a doc that
// doesn't exist (that would be a dishonest indicator). The `?mock=…` query
// param seeds a synthetic shape so the indicator's two states can be reviewed
// and tested without a companion.
export type InterestDocMeta = {
  hasDoc: boolean;
  // ISO timestamp of the doc's last edit, when known. Drives the "updated …"
  // dateline on the profile row.
  updatedAt?: string;
  // Full markdown from `~/.config/scout/interests/<id>.md`, when the companion
  // can read one. This is the research-scope source of truth.
  body?: string;
};

export type InterestWithDoc = Interest & { doc: InterestDocMeta };

// Stable per-interest key used for the doc editor deep-link and the
// `interests/<id>.md` store. Prefers the interest's own id; falls back to a
// slug of the topic so a companion-adopted interest (topic-only, no id) still
// gets a deterministic, shareable URL.
export function interestKey(i: Interest): string {
  const id = i.id?.trim();
  if (id) return id;
  return (
    i.topic
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "interest"
  );
}

// The companion's topic list, in its order, reusing the local record (for its
// id) when a topic matches case-insensitively. A topic with no local record
// gets its key as id.
function mergeInterests(local: Interest[], topics: string[]): Interest[] {
  const byTopic = new Map(local.map((i) => [i.topic.trim().toLowerCase(), i]));
  return topics.map(
    (topic) =>
      byTopic.get(topic.trim().toLowerCase()) ?? {
        id: interestKey({ id: "", topic }),
        topic,
      },
  );
}

// Fetch the FULL interest set from the authed GET /v0/interests — real stable
// ids (so a chat change's `interestId` matches the rendered card), topics, and
// doc metadata in one round-trip. Works from any origin the companion allows.
// Returns null without a pairing token, or when no companion answers, so the
// caller can fall back to local settings.
export async function fetchInterestsFull(token: string): Promise<{
  interests: Interest[];
  meta: Record<string, InterestDocMeta>;
} | null> {
  if (!isClient() || !token) return null;
  try {
    const res = await companionFetch(PATHS.interests, {
      token,
      timeoutMs: 2500,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      interests?: Array<{
        id?: string;
        topic?: string;
        hasDoc?: boolean;
        docUpdatedAt?: string;
        doc?: string | null;
      }>;
    };
    if (!Array.isArray(body.interests)) return null;
    const interests: Interest[] = [];
    const meta: Record<string, InterestDocMeta> = {};
    for (const it of body.interests) {
      const id = (it.id ?? "").trim();
      const topic = (it.topic ?? "").trim();
      if (!topic) continue;
      const interest: Interest = { id, topic };
      interests.push(interest);
      meta[interestKey(interest)] = {
        hasDoc: Boolean(it.hasDoc),
        updatedAt:
          typeof it.docUpdatedAt === "string" ? it.docUpdatedAt : undefined,
        body: typeof it.doc === "string" ? it.doc : undefined,
      };
    }
    return { interests, meta };
  } catch {
    return null;
  }
}

// The companion's interests, the one source of truth when it serves this page:
// the full set with doc metadata from /v0/interests, else its topic list from
// /v0/config merged onto `local`. Null when the companion isn't serving this
// page or holds no interests, so the caller keeps `local`.
export async function fetchCompanionInterestSet(
  token: string,
  local: Interest[],
): Promise<{
  interests: Interest[];
  meta: Record<string, InterestDocMeta>;
} | null> {
  const full = await fetchInterestsFull(token);
  if (full && full.interests.length > 0) return full;
  const topics = await fetchCompanionInterests();
  if (topics.length === 0) return null;
  return { interests: mergeInterests(local, topics), meta: {} };
}

// Synthetic doc metadata for reviewing and testing the indicator's two states
// without a companion. Marks every other interest as having a doc so reviewers see
// both "intent doc" and "no doc yet" rows. Gated behind `?mock` — never used
// against real data. `seed=full` marks all interests as having a doc.
export function mockDocMeta(
  interests: Interest[],
  seed: string | null,
): Record<string, InterestDocMeta> {
  if (seed === null) return {};
  const out: Record<string, InterestDocMeta> = {};
  interests.forEach((it, idx) => {
    const has = seed === "full" ? true : idx % 2 === 0;
    out[interestKey(it)] = has
      ? {
          hasDoc: true,
          updatedAt: SAMPLE_DOC_DATES[idx % SAMPLE_DOC_DATES.length],
        }
      : { hasDoc: false };
  });
  return out;
}

// Fixed sample timestamps so the mock is deterministic (no `new Date()` — keeps
// static export and review screenshots stable).
const SAMPLE_DOC_DATES = [
  "2026-05-30T09:12:00.000Z",
  "2026-05-28T17:45:00.000Z",
  "2026-05-31T08:03:00.000Z",
];

// Sample interests used only when `?mock` is set and the user has none stored,
// so the indicator and list layout are reviewable on a clean machine.
export const SAMPLE_INTERESTS: Interest[] = [
  { id: "ai-policy", topic: "AI policy & regulation" },
  { id: "space-launch", topic: "Commercial space launch" },
  { id: "climate-tech", topic: "Climate tech & batteries" },
  { id: "formula-1", topic: "Formula 1" },
];
