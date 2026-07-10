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

process.stdin.on("data", () => {});

// Point the canned source image at the companion's OWN loopback origin so it
// actually loads under the E2E offline guard (which aborts every non-loopback
// request). The companion serves /icon-192.png from its static webroot, so the
// `![source image](…)` line below exercises the real image parse → render path
// (PER-211) without a network dependency. Port mirrors playwright.config's
// SCOUT_E2E_PORT default; the stub inherits the companion's env.
const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const SOURCE_IMAGE = `http://127.0.0.1:${PORT}/icon-192.png`;

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
    `  ![source image](${SOURCE_IMAGE})`,
    // In-depth body blockquote (PER-214): the few concise paragraphs the detail
    // view renders on click. The feed card stays short (just the bullet above);
    // this depth must appear ONLY after the card is opened.
    // Body carries inline markdown (**bold** + `code`) on purpose: real briefs
    // use both heavily, and PER-236 asserts the detail view renders them as
    // real <strong>/<code> elements instead of literal asterisks/backticks.
    "  > The lab reported a **measurable drop** in deceptive behavior under its new training regime, and published the `eval-harness` alongside.",
    "  >",
    "  > Independent researchers called the methodology promising but said the",
    "  > results need replication on larger models before they generalize.",
    "  >",
    "  > The useful signal is not only the score change; it is that the team exposed",
    "  > enough setup detail for outside labs to compare prompts, failure modes, and",
    "  > training data assumptions instead of taking the headline claim at face value.",
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
