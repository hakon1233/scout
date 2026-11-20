#!/usr/bin/env node
// The hosted Supabase project's schema and SQL tests, without Docker or psql.
//
//   node scripts/supabase-hosted.mjs push   apply pending supabase/migrations, as `supabase db push`
//   node scripts/supabase-hosted.mjs test   run supabase/tests/*.sql; nothing is kept
//
// Both talk to the Management API's SQL endpoint for the project in
// SUPABASE_PROJECT_REF, with the personal access token in SUPABASE_ACCESS_TOKEN.
//
// push applies each migration file in one transaction and records it in
// supabase_migrations.schema_migrations (version, name, statements) the way the CLI
// does, so `supabase migration list` sees it as applied.
//
// test runs each test file inside one transaction that always ends in an error, so
// every row it wrote rolls back. Its pgTAP lines are collected into a temp table and
// carried out in that error's message, since the endpoint returns only the last
// statement's rows. Row counts in public and auth are compared before and after.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAP_MARKER = "SCOUT_TAP_OUTPUT";

/** Splits SQL into statements at top-level semicolons (quotes, comments and dollar quotes respected). */
export function splitStatements(sql) {
  const out = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") (depth++, (i += 2));
        else if (sql[i] === "*" && sql[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
    } else if (c === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
      } else i++;
    } else if (c === ";") {
      const stmt = sql.slice(start, i).trim();
      if (stmt) out.push(stmt);
      start = ++i;
    } else i++;
  }
  const tail = sql.slice(start).trim();
  if (tail && stripLeadingComments(tail)) out.push(tail);
  return out;
}

/** The statement without the comments and blank lines before it. */
export function stripLeadingComments(stmt) {
  let s = stmt;
  for (;;) {
    s = s.trimStart();
    if (s.startsWith("--")) {
      const end = s.indexOf("\n");
      s = end === -1 ? "" : s.slice(end + 1);
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    } else return s;
  }
}

const literal = (s) => `'${s.replaceAll("'", "''")}'`;

/** One migration file as one transaction that also records it in the CLI's history table. */
export function migrationSql(fileName, sql) {
  const match = /^(\d+)_(.*)\.sql$/.exec(fileName);
  if (!match) throw new Error(`not a migration file name: ${fileName}`);
  const [, version, name] = match;
  const statements = splitStatements(sql);
  const array = statements.length
    ? `array[${statements.map(literal).join(",\n")}]::text[]`
    : "'{}'::text[]";
  return `begin;
${sql}
;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
insert into supabase_migrations.schema_migrations (version, name, statements)
values (${literal(version)}, ${literal(name)}, ${array});
commit;`;
}

/**
 * A pgTAP test file rewritten so its output survives a rollback: each top-level
 * select writes its rows into a temp table, and a closing error carries them out
 * and undoes everything. The file's own begin/rollback/commit are dropped.
 */
export function testSql(sql) {
  const body = splitStatements(sql)
    .filter(
      (s) =>
        !/^(begin|rollback|commit|end)$/i.test(stripLeadingComments(s).trim()),
    )
    .map((s) =>
      /^select\b/i.test(stripLeadingComments(s))
        ? `insert into pg_temp.scout_tap (line)
select (select string_agg(value, ' ') from jsonb_each_text(to_jsonb(r)))
from (${stripLeadingComments(s)}) r`
        : s,
    );
  return `begin;
create temp table scout_tap (n bigint generated always as identity, line text) on commit drop;
grant all on pg_temp.scout_tap to public;
${body.join(";\n")};
reset role;
do $scout$ begin
  raise exception '${TAP_MARKER}%', E'\\n' || coalesce(
    (select string_agg(line, E'\\n' order by n) from pg_temp.scout_tap where line is not null), '');
end $scout$;`;
}

/** Pass and fail counts from TAP lines. */
export function tapSummary(tap) {
  const lines = tap.split("\n");
  const failed = lines.filter((l) => /^not ok\b/.test(l));
  const passed = lines.filter((l) => /^ok\b/.test(l));
  return { passed: passed.length, failed };
}

function client() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token)
    throw new Error("set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN");
  return async function query(sql) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    const text = await res.text();
    if (res.ok) return { ok: true, rows: JSON.parse(text) };
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    return { ok: false, message };
  };
}

async function push(query) {
  const files = (await readdir(path.join(root, "supabase/migrations")))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const history = await query(
    "select coalesce((select array_agg(version) from supabase_migrations.schema_migrations), '{}') as v",
  );
  const applied = new Set(history.ok ? history.rows[0].v : []);
  let failures = 0;
  for (const file of files) {
    if (applied.has(file.split("_")[0])) continue;
    const sql = await readFile(
      path.join(root, "supabase/migrations", file),
      "utf8",
    );
    const res = await query(migrationSql(file, sql));
    console.log(res.ok ? `applied ${file}` : `FAILED ${file}\n${res.message}`);
    if (!res.ok) {
      failures++;
      break;
    }
  }
  if (!failures) console.log("migrations up to date");
  return failures;
}

const ROW_COUNTS = `select coalesce(json_object_agg(t, n), '{}') as counts from (
  select table_schema || '.' || table_name as t,
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I',
      table_schema, table_name), false, true, '')))[1]::text::bigint as n
  from information_schema.tables
  where table_schema in ('public', 'auth') and table_type = 'BASE TABLE') s`;

async function rowCounts(query) {
  const res = await query(ROW_COUNTS);
  if (!res.ok) throw new Error(res.message);
  return res.rows[0].counts;
}

async function test(query) {
  const dir = path.join(root, "supabase/tests");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const before = await rowCounts(query);
  let failures = 0;
  for (const file of files) {
    const res = await query(
      testSql(await readFile(path.join(dir, file), "utf8")),
    );
    const at = res.ok ? -1 : res.message.indexOf(TAP_MARKER);
    if (at === -1) {
      failures++;
      console.log(`FAIL ${file}: ${res.ok ? "no TAP output" : res.message}`);
      continue;
    }
    const tap = res.message
      .slice(at + TAP_MARKER.length)
      .replace(/\nCONTEXT:[\s\S]*$/, "")
      .trim();
    const { passed, failed } = tapSummary(tap);
    const planned = /# Looks like you planned (\d+) tests? but ran (\d+)/.exec(
      tap,
    );
    if (failed.length || planned) failures++;
    console.log(
      `${failed.length || planned ? "FAIL" : "ok  "} ${file}: ${passed} passed, ${failed.length} failed`,
    );
    if (failed.length || process.env.VERBOSE) console.log(tap);
  }
  const after = await rowCounts(query);
  const changed = Object.keys({ ...before, ...after }).filter(
    (t) => before[t] !== after[t],
  );
  if (changed.length) {
    failures++;
    console.log(`rows left behind in: ${changed.join(", ")}`);
  } else console.log("no rows left behind");
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  const run = { push, test }[command];
  if (!run) {
    console.error("usage: supabase-hosted.mjs push|test");
    process.exit(2);
  }
  run(client()).then(
    (failures) => process.exit(failures ? 1 : 0),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
