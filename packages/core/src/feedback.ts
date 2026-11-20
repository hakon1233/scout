// Feedback to the Scout team from the hosted chat. The model drafts a note as a
// `feedback` op; the reader sends it with Confirm on a card, and the Worker
// stores it (supabase `send_feedback`). This module owns the op: its prompt
// lines, its output-schema fields and the check of what the model wrote. The
// chat adds the prompt lines only while the `feedback_on` setting is on, so
// with it off the prompt is unchanged.

import type { PendingFeedback } from "./contract.ts";
import type { ProposedChange } from "./chat-changes.ts";

export type FeedbackKind = PendingFeedback["kind"];

const KINDS: readonly FeedbackKind[] = ["bug", "wish", "other"];

export const MAX_FEEDBACK_SUMMARY_CHARS = 120;
export const MAX_FEEDBACK_TEXT_CHARS = 2000;

// The confirm turn's reply once the note is stored.
export const FEEDBACK_SENT_REPLY = "Sent to the Scout team. Thank you.";

// The op's line in the prompt's output example.
export const FEEDBACK_PROMPT_OP =
  "    // Draft a note to the Scout team (see the feedback rule):\n" +
  '    { "op": "feedback", "kind": "bug" | "wish" | "other", "summary": "<one line>", "text": "<the note>" },';

// The op's rule in the prompt's Rules list.
export const FEEDBACK_PROMPT_RULES = [
  "- Feedback is about the Scout app itself (a bug, a wish, anything else), never a",
  "    topic's news. Help first: when Scout already does what they ask or it works by",
  "    design, explain that before anything else. When something is broken or missing",
  "    and they would like the Scout team to hear it, offer once to pass it on. When",
  "    they say yes, or ask to send feedback, emit one `feedback` op: `kind` bug, wish",
  "    or other; `summary` one short line; `text` the note in their words, plainly.",
  "    Leave out personal details (names, emails, phone numbers). A `feedback` is",
  "    CONFIRM-GATED: nothing is sent until the user presses [Confirm] on a card. Its",
  '    `reply` is a PENDING PROPOSAL, e.g. "Here is the note. Confirm below to send',
  '    it to the Scout team." Never say it is sent. To change the wording, the user',
  "    tells you and you emit a new `feedback` op.",
].join("\n");

// The op's extra fields in the model's JSON output schema.
export const FEEDBACK_SCHEMA_PROPERTIES = {
  kind: { type: "string", enum: [...KINDS] },
  summary: { type: "string" },
  text: { type: "string" },
} as const;

// The first well-formed feedback op the model wrote, trimmed and cut to size,
// or undefined when there is none.
export function feedbackOf(
  proposed: ProposedChange[],
): PendingFeedback | undefined {
  for (const change of proposed) {
    if (change.op !== "feedback") continue;
    const kind = KINDS.find((k) => k === change.kind);
    const summary = clean(change.summary, MAX_FEEDBACK_SUMMARY_CHARS);
    const text = clean(change.text, MAX_FEEDBACK_TEXT_CHARS);
    if (kind && summary && text) return { kind, summary, text };
  }
  return undefined;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max).trim() : "";
}
