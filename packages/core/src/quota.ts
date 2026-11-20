// The database's quota refusals (Postgres P0001 with a hint naming the limit,
// raised by check_interest_allowance) as sentences for the reader. The web app
// and the Worker both show them, so they live here once.

/** A quota refusal as the reader sees it, or null when `err` is not one. */
export function quotaMessage(err: {
  code?: string;
  hint?: string;
  message?: string;
}): string | null {
  if (err.code !== "P0001") return null;
  const limit = /of (\d+)/.exec(err.message ?? "")?.[1];
  switch (err.hint) {
    case "daily_interests":
      return `Your plan has room for ${plural(limit, "daily interest")}, and it's in use. Set one to weekly or pause it first.`;
    case "weekly_interests":
      return `Your plan has room for ${plural(limit, "weekly interest")}, and they're in use. Pause one first.`;
    case "max_interests":
      return `Your plan has room for ${plural(limit, "interest")}, and they're in use. Delete one first.`;
    case "max_doc_chars":
      return "That interest's description is too long for your plan.";
    default:
      return null;
  }
}

/** "1 run", "3 runs", or "runs" when the count is unknown. */
export function plural(n: string | number | undefined, word: string): string {
  if (n === undefined) return `${word}s`;
  return `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
}
