// Per-interest brief settings: their defaults, the one check every writer
// uses (the companion's route, the hosted data module), and the mapping to
// the hosted `interests` columns (supabase/migrations/*_brief_settings.sql).

import type { BriefLength, BriefSettings } from "./contract.ts";

// The most stories a section may carry, whatever the settings.
export const MAX_STORIES = 4;

export const DEFAULT_BRIEF_SETTINGS: BriefSettings = {
  length: "normal",
  stories: MAX_STORIES,
  evergreen: false,
  searchLocale: null,
  briefLanguage: null,
};

const LENGTHS: readonly BriefLength[] = ["short", "normal", "long"];
// The same patterns as the SQL checks.
const LOCALE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const LANGUAGE_RE = /^[a-z]{2,3}$/;

export type BriefSettingsParse =
  | { ok: true; settings: BriefSettings }
  | { ok: false; error: string };

// Checks a partial settings object and lays it over `base`. Fields left out
// keep base's value; an unknown field or a bad value is an error a reader
// can act on.
export function parseBriefSettings(
  raw: unknown,
  base: BriefSettings = DEFAULT_BRIEF_SETTINGS,
): BriefSettingsParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "settings must be an object" };
  const out: BriefSettings = { ...base };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    switch (key) {
      case "length":
        if (!LENGTHS.includes(value as BriefLength))
          return { ok: false, error: "length must be short, normal or long" };
        out.length = value as BriefLength;
        break;
      case "stories":
        if (
          value !== "relevant" &&
          !(
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 1 &&
            value <= MAX_STORIES
          )
        )
          return {
            ok: false,
            error: `stories must be 1 to ${MAX_STORIES}, or "relevant"`,
          };
        out.stories = value;
        break;
      case "evergreen":
        if (typeof value !== "boolean")
          return { ok: false, error: "evergreen must be true or false" };
        out.evergreen = value;
        break;
      case "searchLocale":
        if (
          value !== null &&
          !(typeof value === "string" && LOCALE_RE.test(value))
        )
          return {
            ok: false,
            error:
              'searchLocale must be a language tag such as "nb-NO", or null',
          };
        out.searchLocale = value;
        break;
      case "briefLanguage":
        if (
          value !== null &&
          !(typeof value === "string" && LANGUAGE_RE.test(value))
        )
          return {
            ok: false,
            error:
              'briefLanguage must be a language code such as "en", or null',
          };
        out.briefLanguage = value;
        break;
      default:
        return { ok: false, error: `unknown setting: ${key}` };
    }
  }
  return { ok: true, settings: out };
}

// Stored settings that are missing or no longer pass the check read as the
// defaults.
export function briefSettingsOrDefault(raw: unknown): BriefSettings {
  if (raw === undefined || raw === null) return { ...DEFAULT_BRIEF_SETTINGS };
  const parsed = parseBriefSettings(raw);
  return parsed.ok ? parsed.settings : { ...DEFAULT_BRIEF_SETTINGS };
}

// The hosted `interests` columns that hold the settings.
export type BriefSettingsRow = {
  brief_length: BriefLength;
  story_count: number;
  stories_relevant_only: boolean;
  evergreen: boolean;
  search_locale: string | null;
  brief_language: string | null;
};

export const BRIEF_SETTINGS_COLUMNS =
  "brief_length,story_count,stories_relevant_only,evergreen,search_locale,brief_language";

export function briefSettingsFromRow(
  row: Partial<BriefSettingsRow>,
): BriefSettings {
  return briefSettingsOrDefault({
    length: row.brief_length ?? DEFAULT_BRIEF_SETTINGS.length,
    stories: row.stories_relevant_only
      ? "relevant"
      : (row.story_count ?? DEFAULT_BRIEF_SETTINGS.stories),
    evergreen: row.evergreen ?? false,
    searchLocale: row.search_locale ?? null,
    briefLanguage: row.brief_language ?? null,
  });
}

// The columns a partial change writes. "relevant" keeps the stored count.
export function briefSettingsToRow(
  change: Partial<BriefSettings>,
): Partial<BriefSettingsRow> {
  const row: Partial<BriefSettingsRow> = {};
  if (change.length !== undefined) row.brief_length = change.length;
  if (change.stories === "relevant") row.stories_relevant_only = true;
  else if (change.stories !== undefined) {
    row.stories_relevant_only = false;
    row.story_count = change.stories;
  }
  if (change.evergreen !== undefined) row.evergreen = change.evergreen;
  if (change.searchLocale !== undefined)
    row.search_locale = change.searchLocale;
  if (change.briefLanguage !== undefined)
    row.brief_language = change.briefLanguage;
  return row;
}
