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

// Accumulate the prompt piped on stdin. The brief path drains + ignores the
// content, but the chat path (emit → emitChat) needs it to detect the chat
// marker and parse the user's message — so it must be captured into a
// module-scoped string. Referencing an undefined `stdin` in emit() was exactly
// the AIR-642 crash (`ReferenceError: stdin is not defined`) that reds every e2e
// `claude` shell-out (brief AND chat) the moment stdin closes.
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

// Point the canned source image at the companion's OWN loopback origin so it
// actually loads under the E2E offline guard (which aborts every non-loopback
// request). The companion serves /icon-192.png from its static webroot, so the
// `![source image](…)` line below exercises the real image parse → render path
// (PER-211) without a network dependency. Port mirrors playwright.config's
// SCOUT_E2E_PORT default; the stub inherits the companion's env.
const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const SOURCE_IMAGE = `http://127.0.0.1:${PORT}/icon-192.png`;

// ── Chat branch (PER-172 / PER-228 / PER-230 / PER-235) ────────────────────
// The companion's chat.ts shells out to `claude` the SAME way research.ts does
// (prompt on stdin, JSON expected back). So this one stub serves BOTH paths; we
// disambiguate on the chat prompt's stable lead line (buildChatPrompt) and, for
// chat, emit the structured `{reply, changes}` JSON the applier validates. This
// is what lets the E2E exercise the action-card state machine end-to-end —
// create (auto-applied → "Applied"+Undo), delete (confirm-gated), and rewrite
// (confirm-gated) — against the REAL /v0/chat + confirm routes, still offline
// and deterministic. Keyed off the user's own words so a spec drives each op by
// phrasing alone, mirroring how the real model picks the op (see chat.ts Rules).
const CHAT_MARKER = "Scout's interest assistant";

// PER-232 Stop/abort e2e hook. When the user's chat message carries this
// sentinel, the chat branch HOLDS its response for SCOUT_STUB_STALL_MS instead
// of answering immediately. That gives a spec a deterministic in-flight window
// to press Stop. The companion kills this child (SIGTERM) when the turn is
// aborted, so the held response never lands and no change persists — exactly
// the PER-232 contract. Without an abort the stall elapses and the (default
// create) op WOULD persist, so a spec that waits past the stall and still finds
// nothing written has proven the server-side turn — not just the client poll —
// was cancelled. Sentinel-gated so it never slows the other chat specs.
const STALL_MARKER = "__STALL_FOR_STOP__";
const STALL_MS = Number(process.env.SCOUT_STUB_STALL_MS ?? 4000);

// AIR-528 chat-retry e2e hook. When the user's chat message carries this
// sentinel, the chat branch exits nonzero instead of writing JSON — the same
// failure shape a real `claude` crash/timeout produces. chat.ts's chatComplete
// rejects on a nonzero exit, so the companion lands the turn `status: "failed"`
// with a real `error_msg` (packages/agent/src/chat.ts:808). Sentinel-gated so
// it never affects the other chat specs.
const FAIL_MARKER = "__FAIL_CHAT_TURN__";

function rawUserMessage(prompt) {
  // buildChatPrompt emits: The user says: / """ / <message> / """ — this is
  // the CURRENT turn's message only. buildChatPrompt also embeds recent PRIOR
  // turns (verbatim, including failed ones — packages/agent/src/chat.ts's
  // `contextTurns`) elsewhere in the prompt for model context, so a sentinel
  // check must scope to this capture group, never to the raw `prompt` string —
  // otherwise a marker from an earlier failed turn leaks forward through that
  // history block and poisons every later turn in the same chat session.
  const m = prompt.match(/"""\n([\s\S]*?)\n"""/);
  return m ? m[1] : "";
}

function parseUserMessage(prompt) {
  // Strip the sentinels before op/topic detection so neither leaks into a
  // created topic — they only control timing/outcome, not content.
  return rawUserMessage(prompt)
    .replace(STALL_MARKER, "")
    .replace(FAIL_MARKER, "")
    .trim();
}

function parseInterestSnapshots(prompt) {
  // The snapshot JSON block (buildInterestSnapshots, pretty-printed via
  // JSON.stringify(snapshots, null, 2)) lists each interest as {id, topic, doc},
  // in the SAME order the companion holds them. Capture id+topic pairs — lazily
  // matching "topic" after "id" naturally skips each entry's `doc` (a real
  // model never invents an id — chat.ts drops unknown ones — so only ids that
  // actually appear here are ever emitted).
  const out = [];
  const re = /"id":\s*"([^"]+)"[\s\S]*?"topic":\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(prompt))) out.push({ id: m[1], topic: m[2] });
  return out;
}

// AIR-691: resolve which interest(s) a delete/rewrite message targets by
// matching the topic(s) the user actually named, instead of always grabbing
// the first snapshot entry. A real model reads the topic list in the prompt
// and picks the id(s) the user meant; a stub that always answers with the
// first id would mask any real product bug that only shows up once a spec
// targets a NON-first interest (confirmed real gap — see AIR-691 filing).
// Sorted longest-topic-first so one topic name being a substring of another
// (e.g. "AI" inside "AI safety") can't mis-resolve, then restored to snapshot
// order. Falls back to the first snapshot when the message names no topic at
// all — this is what every pre-existing spec's generic phrasing ("delete that
// interest for good") relies on, so that exact prior behavior is preserved.
function resolveTargetIds(message, snapshots) {
  const lower = message.toLowerCase();
  const matched = [...snapshots]
    .sort((a, b) => b.topic.length - a.topic.length)
    .filter((s) => s.topic && lower.includes(s.topic.toLowerCase()));
  if (matched.length > 0) {
    const matchedIds = new Set(matched.map((s) => s.id));
    return snapshots.filter((s) => matchedIds.has(s.id)).map((s) => s.id);
  }
  return snapshots.length > 0 ? [snapshots[0].id] : [];
}

function topicFromMessage(message) {
  // Pull the topic out of a create phrasing ("…about X", "track X", "add X").
  const about = message.match(/\babout\s+(.+)$/i);
  if (about) return about[1].replace(/[.?!]+$/, "").trim();
  const verb = message.match(
    /\b(?:track|add|create(?:\s+an?\s+interest)?)\s+(.+)$/i,
  );
  if (verb) return verb[1].replace(/[.?!]+$/, "").trim();
  return "New interest";
}

function emitChat(prompt) {
  // AIR-528: simulate a real model/CLI failure — no stdout JSON, nonzero exit —
  // before any op detection, so a spec can drive a deterministic `failed` turn.
  // Scoped to THIS turn's message (see rawUserMessage) — checking the raw
  // `prompt` would also match the marker echoed back in later turns' "Recent
  // conversation" history, failing every turn for the rest of the session.
  if (rawUserMessage(prompt).includes(FAIL_MARKER)) {
    process.stderr.write("stub: simulated chat model failure\n");
    process.exit(1);
  }

  const message = parseUserMessage(prompt);
  const snapshots = parseInterestSnapshots(prompt);
  const targetIds = resolveTargetIds(message, snapshots);
  const firstId = targetIds[0] ?? "";
  let out;

  if (/\b(rewrite|start over|from scratch)\b/i.test(message) && firstId) {
    // Confirm-gated full rewrite (PER-235): propose the WHOLE doc, do NOT claim
    // it's done. chat.ts collects this into pending_rewrite.
    out = {
      reply:
        "Here's a full rewrite — review the diff and Apply below. Nothing changes until you do.",
      changes: [
        {
          op: "rewrite",
          interestId: firstId,
          doc: [
            "# Rewritten intent",
            "",
            "A clean-slate replacement doc proposed for your review.",
            "",
            "- Fresh angle one",
            "- Fresh angle two",
          ].join("\n"),
        },
      ],
    };
  } else if (
    /\b(delete|remove|drop|get rid of|stop tracking)\b/i.test(message) &&
    targetIds.length > 0
  ) {
    // Confirm-gated delete (PER-230): propose, phrase as pending — the interest
    // stays alive until the user presses [Delete]. AIR-691: a compound message
    // naming MULTIPLE topics ("delete X and Y") resolves to one delete change
    // per named topic, mirroring how a real model would emit one `delete` op
    // per interest the user asked to remove in the same turn — this is what
    // exposes chat.ts's `pendingDeletes[0]` truncation (only the first
    // confirm-gated proposal in a turn is ever surfaced to the FE).
    const topics = targetIds.map(
      (id) => snapshots.find((s) => s.id === id)?.topic ?? "that interest",
    );
    out = {
      reply:
        topics.length > 1
          ? `Delete ${topics.join(" and ")}? Confirm below — this can't be undone here.`
          : "Delete that interest? Confirm below — this can't be undone here.",
      changes: targetIds.map((id) => ({ op: "delete", interestId: id })),
    };
  } else {
    // Default: create a new interest. Auto-applied by chat.ts, so the FE renders
    // an "Applied" card with a real Undo and the doc lands in the rail.
    const topic = topicFromMessage(message);
    out = {
      reply: `Done — created “${topic}” and drafted an intent doc for it.`,
      changes: [
        {
          op: "create",
          topic,
          doc: [
            `# ${topic}`,
            "",
            `What you want from ${topic}:`,
            "",
            "- Surface concrete developments, not vibes.",
            "- Prefer primary sources.",
          ].join("\n"),
        },
      ],
    };
  }

  const writeOut = () => {
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  };
  // PER-232: hold the answer so a Stop can land mid-flight. The pending timer
  // keeps this child alive; a SIGTERM from the companion's abort tears it down
  // before writeOut fires, so nothing is ever emitted or persisted.
  if (prompt.includes(STALL_MARKER)) {
    setTimeout(writeOut, STALL_MS);
    return;
  }
  writeOut();
}

// Guards against a double-invocation: the real `.on("end", emit)` listener and
// the `setTimeout(emit, 500)` fallback below can BOTH fire on a slow/loaded
// machine (e.g. a CPU-starved CI runner) if stdin's 'end' event lands after the
// 500ms fallback has already queued — without this, a second emit() re-parses
// the same stdin and can double-write/double-exit mid-flight.
let emitted = false;

function emit() {
  if (emitted) return;
  emitted = true;
  if (stdin.includes(CHAT_MARKER)) return emitChat(stdin);
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
