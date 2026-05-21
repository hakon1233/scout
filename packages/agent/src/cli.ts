#!/usr/bin/env node
// @notiva/agent — local companion CLI.
//
// Subcommands:
//   pair          Pair this device with your Notiva account using a one-time code
//                 from the web UI. Stores a Supabase JWT under ~/.config/notiva/agent.json.
//   run [--once]  Run the brief generation loop. With --once we do a single pass and exit.
//   status        Print "agent connected as <email> | last brief: <when>".
//
// Constraint: we MUST NOT transmit the user's Anthropic OAuth token (`sk-ant-oat01-…`)
// off-machine. Synthesis runs by spawning the user's local `claude` CLI; we never
// read or forward that token.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".config", "notiva");
const CONFIG_FILE = path.join(CONFIG_DIR, "agent.json");

// These ship in the static web build too — they are public values, safe to hardcode
// at publish time. The CLI reads NOTIVA_SUPABASE_URL / NOTIVA_SUPABASE_ANON_KEY env
// vars first for dev overrides; the real defaults are filled in by the release CI.
const SUPABASE_URL =
  process.env.NOTIVA_SUPABASE_URL ?? "__SUPABASE_URL_AT_PUBLISH__";
const SUPABASE_ANON_KEY =
  process.env.NOTIVA_SUPABASE_ANON_KEY ?? "__SUPABASE_ANON_KEY_AT_PUBLISH__";

type Config = {
  user_id: string;
  access_token: string;
  expires_at: number;
  exa_key?: string;
};

async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as Config;
  } catch {
    return null;
  }
}

async function saveConfig(cfg: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function authedClient(cfg: Config): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${cfg.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function cmdPair(code?: string): Promise<void> {
  const c = (code ?? (await prompt("Pairing code: "))).trim().toUpperCase();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/companion-token`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ code: c }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`pair failed (${res.status}): ${body}`);
  }
  const { access_token, user_id, expires_at } = (await res.json()) as {
    access_token: string;
    user_id: string;
    expires_at: number;
  };
  await saveConfig({ access_token, user_id, expires_at });
  console.log("Paired. JWT stored at", CONFIG_FILE);
}

async function cmdStatus(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) return console.log("not paired. run `npx @notiva/agent pair`.");
  const supa = authedClient(cfg);
  const { data: briefs } = await supa
    .from("briefs")
    .select("generated_at, status")
    .order("generated_at", { ascending: false })
    .limit(1);
  const last = briefs?.[0];
  console.log(`paired as ${cfg.user_id}`);
  if (last) console.log(`last brief: ${last.status} @ ${last.generated_at}`);
  else console.log("no briefs yet.");
}

async function cmdRun(opts: { once: boolean; dryRun: boolean }): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error("not paired. run `npx @notiva/agent pair` first.");
  const supa = authedClient(cfg);

  do {
    await runOnce(supa, cfg, opts.dryRun);
    if (opts.once) break;
    // Light polling cadence; the v0 web app shows the latest brief, not push.
    await sleep(15 * 60 * 1000);
  } while (true);
}

async function runOnce(
  supa: SupabaseClient,
  cfg: Config,
  dryRun: boolean,
): Promise<void> {
  const { data: interestRows, error } = await supa
    .from("interests")
    .select("topic")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`interests fetch failed: ${error.message}`);
  const interests = (interestRows ?? []).map((r) => r.topic as string).slice(0, 6);
  if (interests.length === 0) {
    console.log("no interests set in the web app yet — nothing to do.");
    return;
  }
  console.log(`fetching articles for ${interests.length} interests:`, interests);

  const allArticles: Array<{
    interest: string;
    title: string;
    url: string;
    snippet?: string;
    published?: string;
    text?: string;
  }> = [];

  for (const topic of interests) {
    const results = await exaSearch(cfg, topic);
    for (const r of results) {
      allArticles.push({
        interest: topic,
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.text?.slice(0, 600),
        published: r.publishedDate,
        text: r.text,
      });
    }
  }

  if (allArticles.length === 0) {
    console.log("exa returned no articles for any topic.");
    return;
  }

  // Create the brief row first (status=pending) so the web UI sees activity.
  const { data: brief, error: insertErr } = await supa
    .from("briefs")
    .insert({ user_id: cfg.user_id, status: "pending" })
    .select("id")
    .single();
  if (insertErr || !brief) throw new Error(`brief insert failed: ${insertErr?.message}`);

  try {
    const markdown = dryRun
      ? `# Your brief\n\n*(dry-run — would have synthesized ${allArticles.length} articles)*`
      : await synthesizeWithClaude(interests, allArticles);

    await supa
      .from("articles")
      .insert(
        allArticles.map((a) => ({
          brief_id: brief.id,
          user_id: cfg.user_id,
          url: a.url,
          title: a.title,
          snippet: a.snippet,
        })),
      );

    await supa
      .from("briefs")
      .update({ status: "ready", summary_md: markdown, generated_at: new Date().toISOString() })
      .eq("id", brief.id);

    console.log(`brief ${brief.id} ready.`);
  } catch (err) {
    await supa
      .from("briefs")
      .update({ status: "failed", error_msg: String(err) })
      .eq("id", brief.id);
    throw err;
  }
}

async function exaSearch(
  cfg: Config,
  query: string,
): Promise<
  Array<{ title?: string; url: string; publishedDate?: string; text?: string }>
> {
  // First try the shared Exa proxy. If the proxy responds with byo_key_required
  // we fall through to the user's own Exa key (configured in agent.json).
  const res = await fetch(`${SUPABASE_URL}/functions/v1/exa-search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${cfg.access_token}`,
    },
    body: JSON.stringify({ query, numResults: 4 }),
  });
  if (res.ok) {
    const json = (await res.json()) as { results?: Array<{ url: string; title?: string; text?: string; publishedDate?: string }> };
    return json.results ?? [];
  }
  const errBody = await res.json().catch(() => ({}));
  if (res.status === 403 && (errBody as { error?: string }).error === "byo_key_required") {
    if (!cfg.exa_key) {
      throw new Error("shared Exa key not configured upstream; add `exa_key` to ~/.config/notiva/agent.json");
    }
    const direct = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.exa_key },
      body: JSON.stringify({
        query,
        numResults: 4,
        type: "neural",
        useAutoprompt: true,
        contents: { text: { maxCharacters: 1800 } },
      }),
    });
    if (!direct.ok) throw new Error(`exa BYO failed: ${direct.status}`);
    return ((await direct.json()) as { results?: [] }).results ?? [];
  }
  if (res.status === 429) {
    throw new Error("exa daily cap hit for this user — try tomorrow or set a BYO Exa key.");
  }
  throw new Error(`exa proxy failed (${res.status}): ${JSON.stringify(errBody)}`);
}

async function synthesizeWithClaude(
  interests: string[],
  articles: Array<{ interest: string; title: string; url: string; text?: string; published?: string }>,
): Promise<string> {
  const prompt = buildSynthesisPrompt(interests, articles);

  return await new Promise<string>((resolve, reject) => {
    // We pass `--print` so claude exits after one turn and writes to stdout.
    // No tools enabled — synthesis is pure text in / text out.
    const child = spawn(
      "claude",
      ["--print", "--output-format", "text", "--allowed-tools", ""],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) =>
      reject(new Error(`failed to spawn 'claude' — is the Claude Code CLI installed and on PATH? (${e.message})`)),
    );
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`));
      const text = stdout.trim();
      if (!text) return reject(new Error("claude returned empty output"));
      resolve(text);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function buildSynthesisPrompt(
  interests: string[],
  articles: Array<{ interest: string; title: string; url: string; text?: string; published?: string }>,
): string {
  const lines: string[] = [];
  lines.push("You are Notiva, an agent that writes personalized news briefs.");
  lines.push("");
  lines.push("Output GitHub-flavored Markdown. Start with `# Your brief`. Group items under `## <topic>` headings,");
  lines.push("one bullet per item with a short summary line then a markdown link `[domain — Title](url)` on the next line.");
  lines.push("Drop off-topic and duplicate items. No filler. Keep the whole brief under ~500 words.");
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
    if (a.text) lines.push(`Excerpt: ${a.text.replace(/\s+/g, " ").slice(0, 1200)}`);
    lines.push("");
  }
  lines.push("Write the brief now. Only include topics in the list above. Cite each item with its URL.");
  return lines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function prompt(label: string): Promise<string> {
  process.stdout.write(label);
  return await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        process.stdin.pause();
        resolve(buf.slice(0, nl));
      }
    });
    process.stdin.resume();
  });
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "pair":
        await cmdPair(rest[0]);
        break;
      case "status":
        await cmdStatus();
        break;
      case "run":
      case undefined:
        await cmdRun({
          once: rest.includes("--once") || cmd === undefined,
          dryRun: rest.includes("--dry-run"),
        });
        break;
      default:
        console.error(`unknown command: ${cmd}. usage: notiva-agent [pair|run|status]`);
        process.exit(2);
    }
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

main();
