// `pnpm eval`: score recorded model outputs against the prompts' rules.
//
// Each case under eval/cases is one model output plus the checks it is
// expected to fail (none, for a good output). The eval passes when every case
// fails exactly its expected checks, so the bad examples prove each check
// catches the failure it names. Fully offline: no model is called.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Interest } from "../src/contract.js";
import { type Check, checkChatOutput, checkResearchOutput } from "./checks.js";

const CASES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "cases",
);

export type CaseResult = {
  kind: "research" | "chat";
  name: string;
  checks: Check[];
  expectFail: string[];
  ok: boolean;
};

function result(
  kind: CaseResult["kind"],
  name: string,
  checks: Check[],
  expectFail: string[],
): CaseResult {
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  const ok =
    failed.length === expectFail.length &&
    failed.every((n) => expectFail.includes(n));
  return { kind, name, checks, expectFail, ok };
}

// Research case: first line `<!-- topic: … | today: YYYY-MM-DD | expect-fail: a, b -->`,
// the rest is the session's raw output.
async function researchCases(): Promise<CaseResult[]> {
  const dir = path.join(CASES_DIR, "research");
  const results: CaseResult[] = [];
  for (const file of (await fs.readdir(dir)).sort()) {
    const text = await fs.readFile(path.join(dir, file), "utf8");
    const [header, ...rest] = text.split("\n");
    const meta = Object.fromEntries(
      header
        .replace(/^<!--|-->$/g, "")
        .split("|")
        .map((part) => part.split(":").map((s) => s.trim())),
    ) as Record<string, string>;
    const expectFail = (meta["expect-fail"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const checks = checkResearchOutput(rest.join("\n"), {
      topic: meta.topic,
      today: meta.today,
    });
    results.push(
      result("research", file.replace(/\.md$/, ""), checks, expectFail),
    );
  }
  return results;
}

type ChatCase = {
  interests: Interest[];
  output: string;
  expect: {
    applied: string[];
    pendingDelete?: string;
    pendingRewrite?: string;
  };
  expectFail: string[];
};

async function chatCases(): Promise<CaseResult[]> {
  const dir = path.join(CASES_DIR, "chat");
  const results: CaseResult[] = [];
  for (const file of (await fs.readdir(dir)).sort()) {
    const c = JSON.parse(
      await fs.readFile(path.join(dir, file), "utf8"),
    ) as ChatCase;
    const checks = await checkChatOutput(c.output, c);
    results.push(
      result("chat", file.replace(/\.json$/, ""), checks, c.expectFail),
    );
  }
  return results;
}

export async function runEval(): Promise<CaseResult[]> {
  return [...(await researchCases()), ...(await chatCases())];
}

function report(results: CaseResult[]): string {
  const lines = [
    "case                                 checks  expected failures       result",
  ];
  for (const r of results) {
    const passed = r.checks.filter((c) => c.pass).length;
    const failed = r.checks.filter((c) => !c.pass);
    lines.push(
      [
        `${r.kind}/${r.name}`.padEnd(37),
        `${passed}/${r.checks.length}`.padEnd(8),
        (r.expectFail.join(", ") || "none").padEnd(24),
        r.ok
          ? "ok"
          : `MISMATCH (failed: ${failed.map((c) => `${c.name} — ${c.detail ?? ""}`).join("; ") || "none"})`,
      ].join(""),
    );
  }
  const good = results.filter((r) => r.expectFail.length === 0);
  lines.push(
    "",
    `${results.filter((r) => r.ok).length}/${results.length} cases as expected; ` +
      `${good.filter((r) => r.ok).length}/${good.length} good outputs pass every check.`,
  );
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await runEval();
  console.log(report(results));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
