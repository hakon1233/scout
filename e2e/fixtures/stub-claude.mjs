#!/usr/bin/env node
// Deterministic, offline stand-in for the `claude` CLI used by the companion's
// research.ts shell-out. The E2E suite points SCOUT_CLAUDE_BIN at this file so
// the zero-prompt core loop can be exercised end-to-end without a real
// Anthropic/Exa key, without network, and at zero quota — the same mock
// philosophy as the @scout/agent unit suite (test/contract.test.ts), but here
// it is a real on-disk executable because we run the *packed artifact*, not
// src/, so spawnFn injection isn't available.
//
// Contract (mirrors what research.ts expects of the real CLI):
//   - reads the synthesis prompt on stdin (we drain + ignore it),
//   - writes a GFM brief to stdout,
//   - exits 0.
//
// The canned brief INTENTIONALLY leads with a conversational preamble line
// before the `# Your brief` H1. research.ts:stripBriefPreamble must strip it,
// so the E2E asserts the preamble never reaches the rendered DOM (PER-113 #1).
// It also carries a `## topic` heading and a `[domain — Title](url)` citation
// so the app's parser produces articles + a Sources panel (PER-106).

let stdin = "";
process.stdin.on("data", (chunk) => {
  stdin += chunk.toString();
});

function emit() {
  const brief = [
    // Preamble that MUST be stripped before render (PER-113 #1).
    "I have enough to write the brief now.",
    "",
    "# Your brief",
    "",
    "## AI safety",
    "- A research lab published new alignment results this week.",
    "  [example.com — Alignment update](https://example.com/alignment)",
    "",
    "## Markets",
    "- Indices closed higher on fresh inflation data.",
    "  [news.example.org — Markets recap](https://news.example.org/markets)",
    "",
  ].join("\n");
  process.stdout.write(brief);
  process.exit(0);
}

// Emit once stdin closes (matches how research.ts ends the child's stdin), with
// a fallback in case stdin is never piped.
process.stdin.on("end", emit);
process.stdin.resume();
setTimeout(emit, 500);
