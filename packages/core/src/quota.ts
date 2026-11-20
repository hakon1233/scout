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
  switch (err.hint ?? "") {
    case "daily_interests":
      if (limit === "0")
        return "Daily topics come with Plus. On Free, set it to weekly.";
      return `Your plan has room for ${plural(limit, "daily topic")}, and it's in use. Set one to weekly or pause it first.`;
    case "weekly_interests":
      return `Your plan has room for ${plural(limit, "weekly topic")}, and they're in use. Pause one first.`;
    case "max_interests":
      return `Your plan has room for ${plural(limit, "topic")}, and they're in use. Delete one first.`;
    case "max_doc_chars":
      return "That topic's description is too long for your plan.";
    case "max_public_interests":
      return `Your plan has room for ${plural(limit, "public topic")}, and they're in use. Make one shared or private first.`;
    case "publishes_per_day":
      return `You can publish ${plural(limit, "time")} a day. Try again tomorrow.`;
    case "republish_wait":
      return "This topic left public less than a day ago. Try again tomorrow.";
    case "reports_per_day":
      return "You've sent a lot of reports today. Try again tomorrow.";
    case "already_reported":
      return "You've already reported this.";
    case "usage_events":
    case "story_marks":
      return "That's more than Scout keeps for one reader. Try again later.";
    case "spend_per_day_usd":
      return "You have reached today's spending limit. Try again tomorrow.";
    default:
      return null;
  }
}

/** "1 run", "3 runs", or "runs" when the count is unknown. */
export function plural(n: string | number | undefined, word: string): string {
  if (n === undefined) return `${word}s`;
  return `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
}
