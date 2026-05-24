// Spawn the local `claude` CLI for synthesis. We never read or forward the user's
// `sk-ant-oat01-…` OAuth token — the binary handles that itself.

import { spawn } from "node:child_process";
import type { Article } from "./state.js";

export async function synthesizeWithClaude(
  interests: string[],
  articles: Article[],
  claudeBin = process.env.NOTIVA_CLAUDE_BIN ?? "claude",
): Promise<string> {
  const prompt = buildSynthesisPrompt(interests, articles);

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      claudeBin,
      ["--print", "--output-format", "text", "--allowed-tools", ""],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
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

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function buildSynthesisPrompt(
  interests: string[],
  articles: Article[],
): string {
  const lines: string[] = [];
  lines.push("You are Notiva, an agent that writes personalized news briefs.");
  lines.push("");
  lines.push(
    "Output GitHub-flavored Markdown. Start with `# Your brief`. Group items under `## <topic>` headings,",
  );
  lines.push(
    "one bullet per item with a short summary line then a markdown link `[domain — Title](url)` on the next line.",
  );
  lines.push(
    "Drop off-topic and duplicate items. No filler. Keep the whole brief under ~500 words.",
  );
  lines.push("");
  lines.push("Topics the reader picked:");
  for (const t of interests) lines.push(`- ${t}`);
  lines.push("");
  lines.push("Recent articles (one per item, grouped by the topic the agent queried):");
  lines.push("");
  for (const a of articles) {
    lines.push(`### [${a.interest}] ${a.title}`);
    lines.push(`URL: ${a.url}`);
    if (a.published) lines.push(`Published: ${a.published}`);
    if (a.snippet)
      lines.push(`Excerpt: ${a.snippet.replace(/\s+/g, " ").slice(0, 1200)}`);
    lines.push("");
  }
  lines.push(
    "Write the brief now. Only include topics in the list above. Cite each item with its URL.",
  );
  return lines.join("\n");
}
