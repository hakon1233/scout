"use client";

import type { Interest } from "./types";
import { isServedFromCompanion } from "./companion";

// Per-interest "intent doc" metadata (PER-155 C1/C4). The intent doc is the
// chat-managed markdown that steers an interest's research session; this module
// only carries the *metadata* the profile landing needs — whether a doc exists
// and when it last changed — not the doc body itself (that's the C5 editor).
//
// C1 (rich interest model + per-interest `.md` store) and C4 (`/v0/chat`) are
// not landed yet, so the live companion has no doc endpoint. This loader is
// forward-compatible: it probes the future endpoint and degrades to "no doc
// for any interest" when it's absent — never inventing a doc that doesn't
// exist (that would be a dishonest indicator). The `?mock=…` query param seeds
// a synthetic shape so the indicator's two states stay reviewable before C1.
export type InterestDocMeta = {
  hasDoc: boolean;
  // ISO timestamp of the doc's last edit, when known. Drives the "updated …"
  // dateline on the profile row.
  updatedAt?: string;
};

export type InterestWithDoc = Interest & { doc: InterestDocMeta };

// Stable per-interest key used for the C5 editor deep-link and the future
// `interests/<id>.md` store. Prefers the interest's own id; falls back to a
// slug of the topic so a companion-adopted interest (topic-only, no id — see
// PER-157) still gets a deterministic, shareable URL.
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

// Deep-link into the per-interest chat / doc editor owned by C5 (PER-155).
// Query-based so it needs no dynamic-route entry in the static export; C5 will
// add `src/app/app/interest/page.tsx` and read `?id`.
export function interestEditorHref(i: Interest): string {
  return `/app/interest?id=${encodeURIComponent(interestKey(i))}`;
}

// Fetch doc metadata keyed by interestKey. Returns {} (→ every interest reads
// as "no doc yet") whenever the companion isn't serving us or the doc endpoint
// doesn't exist yet. Shaped to match the rich-interest payload C1 will expose
// at `/v0/interests`, so this becomes real with no caller change.
export async function fetchInterestDocMeta(): Promise<
  Record<string, InterestDocMeta>
> {
  if (typeof window === "undefined") return {};
  if (!(await isServedFromCompanion())) return {};
  try {
    const res = await fetch(`${window.location.origin}/v0/interests`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as {
      interests?: Array<{
        id?: string;
        topic?: string;
        hasDoc?: boolean;
        docUpdatedAt?: string;
      }>;
    };
    if (!Array.isArray(body.interests)) return {};
    const out: Record<string, InterestDocMeta> = {};
    for (const it of body.interests) {
      const key = (it.id ?? it.topic ?? "").trim();
      if (!key) continue;
      out[key] = {
        hasDoc: Boolean(it.hasDoc),
        updatedAt:
          typeof it.docUpdatedAt === "string" ? it.docUpdatedAt : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

// Synthetic doc metadata for design/QA review of the indicator's two states
// before C1 lands. Marks every other interest as having a doc so reviewers see
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
      ? { hasDoc: true, updatedAt: SAMPLE_DOC_DATES[idx % SAMPLE_DOC_DATES.length] }
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
