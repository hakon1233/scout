// Canonical "MMM d, yyyy" date formatter for the feed/brief surfaces.
//
// Originally lived inside `FeedView.tsx` and was hand-copied into `BriefLayout`
// and `BriefHistory` (whose copy carried a "Mirrors BriefLayout's header date
// format" comment — a keep-in-sync-by-hand coupling). Lifted into this pure
// module so every "Daily/Weekly brief — <date>" and per-story date renders the
// same way, and the timezone-safe handling below can't silently drift away from
// the copies that forgot it.

export function formatDate(iso: string): string {
  // Per-story publish dates are date-only `YYYY-MM-DD` (companion.ts STORY_DATE_RE).
  // `new Date("2026-06-20")` parses as UTC midnight, which toLocaleDateString then
  // renders as the DAY BEFORE for any reader west of UTC (all of the Americas) —
  // the date shown wouldn't match the source's publish date. Build the date from
  // its parts in LOCAL time so the calendar day is stable regardless of timezone.
  // Full ISO timestamps (with a time component) keep the plain Date parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
