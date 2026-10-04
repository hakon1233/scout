# Architecture

Scout has two halves. The **web app** (`src/`) is a static Next.js export: the same files
run on GitHub Pages and from the companion. The **companion** (`packages/agent/`) is a
small Node program on the reader's machine with no runtime dependencies. It stores the
reader's interests and briefs, and it runs research through the reader's own `claude` CLI.
The web app never talks to anything except the companion.

```
browser ──HTTP + pairing token──▶ companion (127.0.0.1:47821) ──stdin──▶ claude CLI
   ▲                                   │                                   (WebSearch,
   └──── static files (Pages or ───────┘                                    WebFetch)
         the companion itself)          ~/.config/scout/  state.json, interests/<id>.md,
                                                          chat/transcript.json
```

Words such as interest, intent doc, run, brief, section, story and coverage are used
as `CONTEXT.md` defines them.

## Codemap

### Companion (`packages/agent/src`)

- `contract.ts`: every path and JSON shape crossing the HTTP boundary. The web app imports
  it too (as `@scout/agent/contract`), so it holds types and constants only.
- `server.ts`, `routes/*`, `http-util.ts`: the loopback HTTP server. `server.ts` checks the
  Host header, the origin and the pairing token before any `/v0` route runs.
  `routes/index.ts` is the table of routes. `http-util.ts` holds the origin allowlist and
  the size-limited body reader.
- `claude-runner.ts`: the only place a `claude` child process starts. It sets the tool
  list (web research or none), the timeout, the abort signal and the working directory.
- `runner.ts`, `research.ts`, `coverage.ts`, `search-skills.ts`, `assembly-skills.ts`: a
  run. The runner researches one interest at a time. Each session gets the search rules
  and that interest's intent doc. The runner then assembles the sections, drops stale
  stories and records coverage.
- `brief-document.ts`: the brief's markdown grammar, read side (topics, stories,
  citations). It is shared with the web app's feed and the weekly digest (`weekly.ts`).
- `chat.ts` (turn lifecycle), `chat-model.ts` (prompt and output parsing),
  `chat-changes.ts` (the applier that validates what the model proposed),
  `chat-transcript.ts`: the chat that edits interests and intent docs.
- `state.ts`, `persistence.ts`, `docs.ts`: storage. `updateState` is the only writer of
  `state.json`: one queue per file, so concurrent writers never lose each other's changes.
  Writes are atomic (temp file, then rename).
- `scheduler.ts`: the daily run, inside the companion process.
- `service.ts`, `cli.ts`, `static.ts`: the `scout-agent` command, the macOS launchd
  service and the static file server for the bundled web app.

### Web app (`src`)

- `app/`: pages. `app/app/page.tsx` is the feed, `app/app/connect` is onboarding and
  pairing, and `app/app/profile` holds the interest chat and intent docs.
- `lib/companion.ts`: finds the companion (same origin first, then a loopback port sweep)
  and makes every call through `companionFetch`/`companionJson`. It also adapts briefs
  into feed articles and holds the start-a-run-and-wait loop.
- `lib/chat.ts`, `lib/interest-docs.ts`, `lib/run-failure.ts`: chat turns, the reader's
  interest list, and the "your run failed" banner.
- `lib/storage.ts`, `lib/safe-storage.ts`, `lib/likes.ts`: browser storage. Every write
  goes through `safe-storage`.

## Invariants

- The companion binds to loopback only. Every request needs an allowed Host. Each route
  in `routes/index.ts` declares its auth level, and the router enforces it before the
  handler runs:
  - most `/v0` routes need an allowed origin (or a same-origin fetch) and the pairing
    token;
  - `/v0/config` hands the pairing token to a page served from the companion itself,
    so it answers same-origin requests only;
  - `/healthz`, `/v0/version` and the static files are open.
- The model never writes files or state. Research sessions return text. Chat sessions get
  no tools and return JSON; `chat-changes.ts` decides what lands. It never trusts a
  model-supplied id, and it holds deletes and full rewrites back for the reader to
  confirm.
- One run and one chat turn at a time. A second request gets 409, and so does a weekly
  digest while a run is in flight.
- The web app keeps working without a companion: it shows a sample brief and the
  onboarding page.
- No credentials live in this repository or pass through the companion. The `claude` CLI
  authenticates itself.

## Testing

- `packages/agent/test`: the companion's unit and HTTP contract tests (`node:test`). They
  use a stub `claude`, a temporary state directory and port 0, so they need no network
  and no model quota. A guard makes any test that points at the real `~/.config/scout`
  throw.
- `src/**/*.test.ts`: web app logic tests, with `fetch` stubbed.
- `e2e/`: Playwright against a real companion built from source, with a stub `claude`
  (`e2e/fixtures/stub-claude.mjs`) and a throwaway home directory.
- `pnpm eval`: scores recorded model outputs against the prompts' rules
  (`packages/agent/eval`), offline.
