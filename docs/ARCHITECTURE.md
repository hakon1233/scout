# Architecture

Scout has two halves. The **web app** (`src/`) is a static Next.js export: the same files
run on GitHub Pages and from the companion. The **companion** (`packages/agent/`) is a
small Node program on the reader's machine with no runtime dependencies. It stores the
reader's interests and briefs, and it runs research through the reader's own `claude` CLI.
The web app never talks to anything except the companion. Both use **`@scout/core`**
(`packages/core/`): the brief grammar and rules as pure TypeScript.

The hosted plan (`docs/HOSTED-PLAN.md`) adds server-side code the web app never imports:
`packages/research` (one interest's research, plus the shared Claude client and prices),
`packages/hosted` (the setup chat), `packages/worker` (the run queue's Cloudflare
Worker) and `supabase/` (schema, RLS, sign-up trigger and run queue in SQL).

```
browser ──HTTP + pairing token──▶ companion (127.0.0.1:47821) ──stdin──▶ claude CLI
   ▲                                   │                                   (WebSearch,
   └──── static files (Pages or ───────┘                                    WebFetch)
         the companion itself)          ~/.config/scout/  state.json, interests/<id>.md,
                                                          chat/transcript.json
```

Words such as interest, intent doc, run, brief, section, story and coverage are used
as `GLOSSARY.md` defines them.

## Codemap

### Core (`packages/core/src`)

Pure TypeScript with no Node, Deno or browser-only APIs: it imports only its own files
(`src/lib/boundaries.test.ts` checks this). Callers import `index.ts` only: the web app
as `@scout/core`, the companion as `#core`.

- `contract.ts`: every path and JSON shape crossing the HTTP boundary. Types and
  constants only.
- `search-skills.ts`, `assembly-skills.ts`: the rules every research session gets, and
  how sections become a brief. The web app's skills page shows them verbatim.
- `research-prompt.ts`: one interest's research prompt (search rules, then its intent
  doc verbatim, then today's date), and the clean-up of the model's lead-in.
- `coverage.ts`: a run's assembly. It cuts each topic's section, sorts stories newest
  first, drops stale ones and records coverage.
- `brief-document.ts`: the brief's markdown grammar, read side (topics, stories,
  citations), used by the web app's feed.
- `weekly.ts`: the weekly digest from the last seven days of daily briefs.
- `chat-prompt.ts`, `chat-changes.ts`: the chat prompt and its output parser, and
  `planChatChanges`, the rules for what of a model's change set lands, waits for a
  confirm or is dropped. The companion and the hosted chat both use them.

The companion runs core's code from `dist/core`: its build compiles core there, and
`#core` in its `package.json` points at that copy. Its tests and `pnpm eval` run with the
`source` condition, which points `#core` at `packages/core/src`.

### Companion (`packages/agent/src`)

- `server.ts`, `routes/*`, `http-util.ts`: the loopback HTTP server. `server.ts` checks the
  Host header, the origin and the pairing token before any `/v0` route runs.
  `routes/index.ts` is the table of routes. `http-util.ts` holds the origin allowlist and
  the size-limited body reader.
- `claude-runner.ts`: the only place a `claude` child process starts. It sets the tool
  list (web research or none), the timeout, the abort signal and the working directory,
  and starts the child without the reader's own Claude Code setup or full environment.
- `runner.ts`, `research.ts`: a run. The runner researches one interest at a time, each
  session with core's research prompt. It then assembles the sections with core's
  coverage rules and saves the brief.
- `weekly.ts`: saves core's weekly digest into the brief history.
- `chat.ts` (turn lifecycle), `chat-model.ts` (core's prompt through `claude`),
  `chat-changes.ts` (core's change rules, then the doc writes),
  `chat-transcript.ts`: the chat that edits interests and intent docs.
- `state.ts`, `persistence.ts`, `docs.ts`: storage. `updateState` is the only writer of
  `state.json`: one queue per file, so writers inside the companion process never lose
  each other's changes (the `pair` command is a separate process). Writes are atomic
  (temp file, then rename).
- `scheduler.ts`: the daily run, inside the companion process.
- `service.ts`, `cli.ts`, `static.ts`: the `scout-agent` command, the macOS launchd
  service and the static file server for the bundled web app.

### Research (`packages/research/src`)

Server-side only, for the hosted plan (`docs/HOSTED-PLAN.md`); the web app never imports
it (`src/lib/boundaries.test.ts` checks this). Plain TypeScript with `fetch`.

- `research-interest.ts`: `researchInterest(interest, {claude})`, one interest's research
  as one Claude API call on Haiku with web search and web fetch. It returns the section,
  its coverage and the cost. Prompt, freshness and coverage come from core.
- `claude-client.ts`: the `ClaudeClient` seam, with a `fetch` adapter and a recorded-
  response adapter for tests. `pricing.ts`: the price table. Every hosted function
  uses these two: no other package defines its own Claude client or prices.

### Hosted functions (`packages/hosted/src`)

Host-neutral logic of the hosted version's functions (see `docs/HOSTED-PLAN.md`): no
Supabase or Deno code. Each function injects its store and its Claude client:
`@scout/research`'s `ClaudeClient` seam (`anthropicClient`, or a stub in tests), whose
price table also gives each turn's cost. Server only: the web app never imports it.

- `chat.ts`: `createChat({claude, store})` gives `turn(userId, message)` and
  `confirm(userId, action)`. A turn sends core's chat prompt, with matching public
  interests, to Haiku 5.5 as structured output; core's `planChatChanges` decides what
  lands; deletes, full rewrites and follows wait for a confirm of the stored proposal.

### Run queue (`packages/worker/src`, `supabase/migrations/*_run_queue.sql`)

Server-side only. One Cloudflare Worker (free plan) runs the hosted runs.

- SQL owns every rule: `claim_runs` reaps stale runs, stops on the kill switch
  (`settings.paused`) or the daily ceiling (`spend_today` against `daily_ceiling_usd`),
  queues due scheduled interests, and claims a batch (public interests first).
  `finish_run` records a result and its cost; a failed first attempt is queued again.
  `request_run` is a reader's "run now", limited by `allowance()`.
- `run-due.ts`: `runDue({queue, claude})`, one tick: claim, research each run with
  `researchInterest`, finish each. Host-neutral; tests use a stub queue.
- `supabase.ts`: the `RunQueue` adapter over PostgREST, and `requestRun` as the reader.
- `http.ts`: `POST /runs {interestId}` with the reader's Supabase JWT; it only queues.
- `index.ts`: the Worker's wiring (cron every minute, fetch). Secrets via `wrangler secret`.

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
- `lib/auth.ts`: hosted sign-in (Google or an email link) and the only place the
  Supabase client and session live. Interface: `hostedAuth()` returns `currentUser`,
  `signInWithGoogle`, `sendMagicLink`, `signOut`, `onAuthChange`, or null when the build
  has no `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Every sign-in
  comes back to `app/app/signin` (implicit flow: tokens in the URL fragment, read by the
  client), so the static export needs no callback route. Errors reach the page as
  plain sentences.

### Hosted backend (`supabase/`)

The hosted plan's schema, RLS and `allowance()` (`migrations/`), with pgTAP tests in
`tests/` (`pnpm test:rls`, against `supabase start`). A trigger on `auth.users` creates
each new account's profile row (free plan, UTC). `config.toml` turns on Google (client
id and secret read from env by name) and the email link, and lists the sign-in page's
redirect URLs.

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
- Only `src/lib/auth.ts` imports supabase-js (`src/lib/boundaries.test.ts`). The browser
  gets the anon key only; RLS decides what it can read.

## Testing

- `packages/core/test`: core's unit tests. No network, no filesystem.
- `packages/research/test`, `packages/hosted/test`, `packages/worker/test`: the hosted
  code through its interfaces, with a stub Claude client that answers with recorded
  responses and an in-memory store or queue. No network.
- `supabase/tests`: pgTAP tests for RLS, quotas, the sign-up trigger and the run queue
  (`pnpm test:rls`, needs Docker; not part of `pnpm check`).
- `packages/agent/test`: the companion's unit and HTTP contract tests (`node:test`). They
  use a stub `claude`, a temporary state directory and port 0, so they need no network
  and no model quota. A guard makes any test that points at the real `~/.config/scout`
  throw.
- `src/**/*.test.ts`: web app logic tests, with `fetch` stubbed. The auth module's tests
  stub the Supabase auth client.
- `e2e/`: Playwright against a real companion built from source, with a stub `claude`
  (`e2e/fixtures/stub-claude.mjs`) and a throwaway home directory.
- `pnpm eval`: checks the prompts' rules against hand-written example outputs, good and
  bad (`packages/agent/eval`), offline. No model is called.
