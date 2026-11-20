// Brief settings: the one check every writer uses, and the hosted columns.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRIEF_SETTINGS,
  briefSettingsFromRow,
  briefSettingsOrDefault,
  briefSettingsToRow,
  parseBriefSettings,
} from "../src/brief-settings.ts";

test("a partial change lays over the stored settings", () => {
  const stored = { ...DEFAULT_BRIEF_SETTINGS, length: "long" as const };
  const parsed = parseBriefSettings(
    { stories: "relevant", searchLocale: "nb-NO" },
    stored,
  );
  assert.deepEqual(parsed, {
    ok: true,
    settings: {
      ...stored,
      stories: "relevant",
      searchLocale: "nb-NO",
    },
  });
});

test("bad values and unknown fields are refused with a reason", () => {
  for (const bad of [
    { length: "huge" },
    { stories: 0 },
    { stories: 5 },
    { stories: 2.5 },
    { evergreen: "yes" },
    { searchLocale: "Norway" },
    { briefLanguage: "en-GB" },
    { colour: "blue" },
    null,
    [],
  ]) {
    const parsed = parseBriefSettings(bad);
    assert.equal(parsed.ok, false, JSON.stringify(bad));
    assert.ok(!parsed.ok && parsed.error.length > 0);
  }
});

test("stored settings that no longer pass read as the defaults", () => {
  assert.deepEqual(briefSettingsOrDefault(undefined), DEFAULT_BRIEF_SETTINGS);
  assert.deepEqual(
    briefSettingsOrDefault({ stories: 9 }),
    DEFAULT_BRIEF_SETTINGS,
  );
});

test("settings round-trip through the hosted columns", () => {
  const settings = {
    length: "short" as const,
    stories: "relevant" as const,
    evergreen: true,
    searchLocale: "de",
    briefLanguage: "en",
  };
  const row = briefSettingsToRow(settings);
  assert.deepEqual(row, {
    brief_length: "short",
    stories_relevant_only: true,
    evergreen: true,
    search_locale: "de",
    brief_language: "en",
  });
  assert.deepEqual(briefSettingsFromRow({ ...row, story_count: 3 }), settings);
  assert.deepEqual(briefSettingsToRow({ stories: 2 }), {
    stories_relevant_only: false,
    story_count: 2,
  });
  assert.deepEqual(briefSettingsFromRow({}), DEFAULT_BRIEF_SETTINGS);
});
