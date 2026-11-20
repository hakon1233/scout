// Rules that live in both core and the schema, since the two languages can't
// share code: topic tags (core's normalizeTags; the database's normalize_tags
// and tags_ok) and the longest topic. Each test feeds both sides the same cases.
//
// Tags differ on purpose in one way: normalizeTags drops what isn't a tag and
// keeps the first MAX_TAGS, while normalize_tags refuses the whole list.

import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "../scripts/sql-test-db.mjs";
import { MAX_TOPIC_CHARS } from "../packages/core/src/limits.ts";
import { MAX_TAGS, normalizeTags } from "../packages/core/src/tags.ts";

const SINGLE = [
  "ai",
  " AI ",
  "Climate",
  "open-source",
  "æøå",
  "ÆØÅ",
  "Bærum",
  "k8s",
  "x",
  "x".repeat(24),
  "x".repeat(25),
  "has space",
  "c++",
  "tag_1",
  "",
  "   ",
  "é",
  "café",
];

async function sqlNormalize(pg, tags) {
  try {
    const { rows } = await pg.query(
      "select public.normalize_tags($1::text[]) as tags",
      [tags],
    );
    return { tags: rows[0].tags };
  } catch (e) {
    return { error: e.message };
  }
}

test("core and SQL agree on what one tag is", async () => {
  const pg = await freshDatabase();
  try {
    for (const raw of SINGLE) {
      const core = normalizeTags([raw]);
      const sql = await sqlNormalize(pg, [raw]);
      if (sql.error) {
        assert.deepEqual(core, [], `${JSON.stringify(raw)}: SQL refuses it`);
      } else {
        assert.deepEqual(core, sql.tags, JSON.stringify(raw));
      }
    }
  } finally {
    await pg.close();
  }
});

test("core and SQL drop empties and repeats the same way, and share the limit", async () => {
  const pg = await freshDatabase();
  try {
    const lists = [
      ["ai", "AI", " ai "],
      ["Tech", "", "science", "tech"],
      ["a1", "b2", "c3", "d4", "e5"].slice(0, MAX_TAGS),
    ];
    for (const list of lists) {
      assert.deepEqual(
        normalizeTags(list),
        (await sqlNormalize(pg, list)).tags,
        JSON.stringify(list),
      );
    }
    const tooMany = ["a1", "b2", "c3", "d4", "e5", "f6"];
    assert.equal(tooMany.length, MAX_TAGS + 1);
    assert.equal(normalizeTags(tooMany).length, MAX_TAGS);
    assert.match((await sqlNormalize(pg, tooMany)).error ?? "", /at most 5/);

    // Whatever core keeps, the interests check (tags_ok) accepts.
    for (const list of [...lists, tooMany, SINGLE]) {
      const { rows } = await pg.query(
        "select public.tags_ok($1::text[]) as ok",
        [normalizeTags(list)],
      );
      assert.equal(rows[0].ok, true, JSON.stringify(list));
    }
  } finally {
    await pg.close();
  }
});

test("the schema's topic check allows exactly MAX_TOPIC_CHARS", async () => {
  const pg = await freshDatabase();
  try {
    const { rows } = await pg.query(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conrelid = 'public.interests'::regclass and c.contype = 'c'
         and pg_get_constraintdef(c.oid) like '%char_length(topic)%'`,
    );
    assert.equal(rows.length, 1, "one topic length check");
    assert.match(rows[0].def, new RegExp(`<= ${MAX_TOPIC_CHARS}\\)`));
  } finally {
    await pg.close();
  }
});
