// A fresh PGlite database (Postgres in WebAssembly) with the SQL test prelude
// (roles, auth stub, pgTAP stand-in) and every migration applied in order. Used by
// scripts/test-sql.mjs and the tests that compare SQL with TypeScript.

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const prelude = readFileSync(
  path.join(root, "scripts/sql-test-prelude.sql"),
  "utf8",
);
const migrationsDir = path.join(root, "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => [f, readFileSync(path.join(migrationsDir, f), "utf8")]);

// The caller closes it.
export async function freshDatabase() {
  const pg = new PGlite();
  try {
    await pg.exec(prelude);
    await pg.exec("set search_path = public, extensions;");
    for (const [name, sql] of migrations) {
      try {
        await pg.exec(sql);
      } catch (e) {
        throw new Error(`migration ${name}: ${e.message}`);
      }
    }
    return pg;
  } catch (e) {
    await pg.close();
    throw e;
  }
}
