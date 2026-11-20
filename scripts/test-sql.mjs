#!/usr/bin/env node
// Runs supabase/tests/*.sql in PGlite (Postgres in WebAssembly), no Docker or network.
//
//   pnpm test:sql            every test file
//   pnpm test:sql voice rls  only files whose name contains one of the words
//
// Each file gets a fresh database: scripts/sql-test-prelude.sql (roles, auth schema
// and a pgTAP stand-in), then every migration in order, then the test. A test's
// `select * from finish()` is swapped for a query of the checks that failed.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { freshDatabase, root } from "./sql-test-db.mjs";

const only = process.argv.slice(2);
const testsDir = path.join(root, "supabase/tests");
const tests = readdirSync(testsDir)
  .filter(
    (f) =>
      f.endsWith(".sql") && (!only.length || only.some((o) => f.includes(o))),
  )
  .sort();

if (!tests.length) {
  console.error("No test files match.");
  process.exit(1);
}

let failed = 0;
for (const file of tests) {
  let pg;
  try {
    pg = await freshDatabase();
    const sql = readFileSync(path.join(testsDir, file), "utf8")
      .replace(/create extension if not exists pgtap[^;]*;/, "")
      .replace(
        /^begin;/m,
        "begin;\nset local search_path = public, extensions;",
      )
      .replace(
        /select \* from finish\(\);\s*rollback;/,
        "reset role;\n" +
          "select n, descr, diag from extensions.tap where not ok order by n;\n" +
          "select count(*)::int as total from extensions.tap;\n" +
          "rollback;",
      );
    const results = await pg.exec(sql);
    const total = results.at(-2).rows[0].total;
    const fails = results.at(-3).rows;
    console.log(
      `${fails.length ? "FAIL" : "ok  "} ${file}: ${total - fails.length}/${total}`,
    );
    for (const f of fails)
      console.log(`     #${f.n} ${f.descr ?? ""} -- ${f.diag ?? ""}`);
    if (fails.length || total === 0) failed++;
  } catch (e) {
    failed++;
    console.log(`FAIL ${file}: ${e.message}`);
  } finally {
    await pg?.close();
  }
}
process.exit(failed ? 1 : 0);
