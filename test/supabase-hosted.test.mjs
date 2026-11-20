import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationSql,
  splitStatements,
  tapSummary,
  testSql,
} from "../scripts/supabase-hosted.mjs";

test("splitStatements keeps semicolons inside quotes, comments and function bodies", () => {
  const sql = `-- a; comment
create table t (x text default 'a;b');
/* block; */ create function f() returns int language plpgsql as $fn$
begin return 1; end $fn$;
select $$x;y$$, "we;ird";
`;
  const statements = splitStatements(sql);
  assert.equal(statements.length, 3);
  assert.match(
    statements[0],
    /^-- a; comment\ncreate table t \(x text default 'a;b'\)$/,
  );
  assert.match(statements[1], /begin return 1; end \$fn\$$/);
  assert.equal(statements[2], `select $$x;y$$, "we;ird"`);
});

test("migrationSql applies the file in one transaction and records it as the CLI does", () => {
  const sql = migrationSql(
    "20261120000000_schema.sql",
    "create table t (x text default 'it''s');",
  );
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /commit;$/);
  assert.match(
    sql,
    /values \('20261120000000', 'schema', array\['create table t \(x text default ''it''''s''\)'\]::text\[\]\)/,
  );
  assert.throws(
    () => migrationSql("schema.sql", ""),
    /not a migration file name/,
  );
});

test("testSql drops the file's own transaction and always ends in an error", () => {
  const sql = testSql(`begin;
select no_plan();
set local role anon;
select ok(true, 'fine');
select * from finish();
rollback;`);
  assert.doesNotMatch(sql, /^rollback/m);
  assert.match(sql, /from \(select ok\(true, 'fine'\)\) r;/);
  assert.match(sql, /set local role anon;/);
  assert.match(sql, /raise exception 'SCOUT_TAP_OUTPUT%'/);
});

test("tapSummary counts passes and lists failures", () => {
  const { passed, failed } = tapSummary(
    "1..3\nok 1 - a\nnot ok 2 - b\n# Failed test 2\nok 3 - c",
  );
  assert.equal(passed, 2);
  assert.deepEqual(failed, ["not ok 2 - b"]);
});
