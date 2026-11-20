// The reader's time zone for scheduled briefs: the saved one, else the one the
// browser reports, else UTC.

export function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultTimeZone(
  saved: string | null,
  detected: string = detectedTimeZone(),
): string {
  return saved && saved.trim() ? saved : detected;
}

/** Every zone the browser knows, always including the current one. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  return zones.includes(current) ? zones : [current, ...zones];
}
