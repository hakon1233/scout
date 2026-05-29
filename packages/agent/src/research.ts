// Single-shot research + synthesis via the local `claude` CLI.
//
// Instead of calling a third-party search API and then asking a model to
// summarize, we hand the whole pipeline to a headless `claude` subprocess
// with WebSearch + WebFetch tools enabled. The model picks queries, reads
// pages, and writes the brief directly.
//
// We never read or forward the user's `sk-ant-oat01-…` OAuth token — the
// `claude` binary handles its own auth from `~/.claude/credentials.json`.

import { spawn } from "node:child_process";
import os from "node:os";

const ALLOWED_TOOLS = "WebSearch,WebFetch,Read,Write";

// Run the synthesis child at a lower scheduling priority than the loopback
// server. The `claude` agent is CPU-heavy (web search + fetch + a full model
// loop) and, on a constrained machine, can starve our single-threaded event
// loop so that GET /v0/briefs and /healthz stop responding mid-synthesis —
// the UI then sees its polling stall (PER-101). Niceness is advisory: it only
// costs `claude` cycles when something else (us, answering a poll) actually
// wants the CPU, so it doesn't slow synthesis on an idle box. Increasing
// niceness is always permitted for unprivileged processes; we swallow the
// rare EPERM/ENOSYS rather than fail the run.
const SYNTH_CHILD_NICENESS = 10;

export type ResearchOptions = {
  claudeBin?: string;
  // Spawn override for tests — lets us inject a stub `claude` without hitting
  // the real binary or network.
  spawnFn?: typeof spawn;
};

export async function researchAndSynthesize(
  interests: string[],
  opts: ResearchOptions = {},
): Promise<string> {
  const claudeBin = opts.claudeBin ?? process.env.SCOUT_CLAUDE_BIN ?? "claude";
  const spawnImpl = opts.spawnFn ?? spawn;
  const prompt = buildResearchPrompt(interests);

  return await new Promise<string>((resolve, reject) => {
    const child = spawnImpl(
      claudeBin,
      [
        "--print",
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
        "--allowed-tools",
        ALLOWED_TOOLS,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    // De-prioritize the heavy child so it can't starve the loopback server.
    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, SYNTH_CHILD_NICENESS);
      } catch {
        // Not fatal — synthesis still runs, just without the niceness hedge.
      }
    }

    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr!.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) =>
      reject(
        new Error(
          `failed to spawn '${claudeBin}' — is the Claude Code CLI installed and on PATH? (${e.message})`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`));
      const text = stdout.trim();
      if (!text) return reject(new Error("claude returned empty output"));
      resolve(text);
    });

    child.stdin!.write(prompt);
    child.stdin!.end();
  });
}

export function buildResearchPrompt(interests: string[]): string {
  const lines: string[] = [];
  lines.push("You are Scout, an agent that researches and writes a personalized news brief.");
  lines.push("");
  lines.push("Use the WebSearch tool to find recent (past 7 days when possible) news on each");
  lines.push("topic below. Use WebFetch on the most promising 1-2 results per topic to get");
  lines.push("enough context to write a real summary, not just a headline rehash.");
  lines.push("");
  lines.push("Topics the reader picked:");
  for (const t of interests) lines.push(`- ${t}`);
  lines.push("");
  lines.push("Output requirements:");
  lines.push("- GitHub-flavored Markdown only. No preamble, no trailing commentary.");
  lines.push("- Start with `# Your brief`.");
  lines.push("- One `## <topic>` section per topic above, in the same order.");
  lines.push("- Under each topic, 2-4 bullets. Each bullet: a one-sentence summary,");
  lines.push("  then a newline with `  [domain — Title](url)` as the citation.");
  lines.push("- Drop off-topic or duplicate results. Skip a topic with `_no fresh news_`");
  lines.push("  if you genuinely can't find anything recent.");
  lines.push("- Keep the whole brief under ~500 words.");
  lines.push("");
  lines.push("Write the brief now.");
  return lines.join("\n");
}
