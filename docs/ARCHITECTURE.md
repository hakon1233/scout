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
- `search-skills.ts`, `relevance-skills.ts`, `assembly-skills.ts`: the rules every
  research session gets (how to search; when a story earns a place, so a run posts
  nothing rather than pad, `plan/research/relevance.md`), and how sections become a
  brief. Plain text, no thresholds in code. The web app's skills page shows them.
- `research-prompt.ts`: one interest's research prompt (search and relevance rules,
  then its intent doc verbatim, then today's date and facts: cadence, the date of the
  topic's last story, the last two briefs' stories as already posted, the brief
  settings), and the clean-up of the model's lead-in. It names the session's web tools:
  `CLI_RESEARCH_TOOLS` (companion) or `API_RESEARCH_TOOLS`.
  `runLimits(doc)` is the one place a run's web budget is set ("Sources first"): an
  intent doc with a `Sources, check first` section gets 1 search and 4 fetches, one
  without gets 2 and 2. The hosted run turns it into the tools' `max_uses`; the team
  runner states it in the prompt and sets `--max-turns` from it. The companion stays
  uncapped (the reader's own plan pays). No per-site rules in code: the doc decides,
  and the chat prompt puts sites the reader names under that heading.
- `brief-settings.ts`: per-interest brief settings (length, story count or "relevant",
  evergreen, search locale, brief language): defaults, the one check every writer uses
  (`parseBriefSettings`) and the mapping to the hosted `interests` columns.
- `coverage.ts`: a run's assembly. It cuts each topic's section, sorts stories newest
  first, drops stale ones (unless the interest is evergreen) and records coverage; a
  section of only "No change since …" or "No news yet." is empty.
- `brief-document.ts`: the brief's markdown grammar, read side (topics, stories,
  citations), used by the web app's feed.
- `weekly.ts`: the weekly digest from the last seven days of daily briefs.
- `chat-prompt.ts`, `chat-changes.ts`: the chat prompt and its output parser, and
  `planChatChanges`, the rules for what of a model's change set lands, waits for a
  confirm or is dropped. The companion and the hosted chat both use them.
- `tags.ts`: the 38 seed tags (browse's chips, the publish check's first choice) and
  `normalizeTags`; the SQL's `tags_ok` enforces the same pattern
  (`test/sql-parity.test.mjs` feeds both the same cases).
- `limits.ts`: the numbers more than one package needs: `MAX_TOPIC_CHARS` (also the
  schema's topic check), `MAX_CHAT_MESSAGE_CHARS`, and `HAIKU_MODEL`, the model of every
  hosted call. `quoted-list.ts`: `quotedList`, the chats' "a", "b" and "c".
- `claimed-run.ts`: a claimed hosted run (`claim_runs`, `team_claim_runs` and
  `team_start_run` all return the same row) and `researchInterestOf`, its research
  input. The Worker's cron and the Scout team runner both use it.
- `publish-check.ts`: what a topic must pass to go public: `publishPrecheck` (title,
  links, length), `buildPublishPrompt` (rules first, the reader's text as JSON-quoted
  data) and `parsePublishCheck`, which fails closed. Also the `POST /publish` shapes.
  The offline prompt checks have hand-written verdicts for it (`cases/publish`).
- `scout-guide.ts`: `SCOUT_GUIDE`, how Scout works in plain words, which the chat
  prompt carries so the chat answers how-to questions; and `APP_PAGES`, the only pages a
  reply may offer to open (`ChatTurn.page`). The parser drops any other page.
- `picks-prompt.ts`: a reader's picks: `buildPicksPrompt` (profile, reading, likes and
  up to 40 candidate topics as JSON data, each under a short key) and `parsePicks`
  (at most 5 known candidates, each with a reason; fails closed).

The companion runs core's code from `dist/core`: its build compiles core there, and
`#core` in its `package.json` points at that copy. Its tests and `pnpm eval` run with the
`source` condition, which points `#core` at `packages/core/src`.

### Companion (`packages/agent/src`)

- `server.ts`, `routes/*`, `http-util.ts`: the loopback HTTP server. `server.ts` checks the
  Host header, the origin and the pairing token before any `/v0` route runs.
  `routes/index.ts` is the table of routes. `http-util.ts` holds the origin allowlist and
  the size-limited body reader.
- `claude-runner.ts`: the only place a `claude` child process starts. It sets the tool
  list (web research or none), `--max-turns`, the timeout, the abort signal and the working directory,
  and starts the child without the reader's own Claude Code setup or full environment.
  It asks for `--output-format json` and returns the result text with the session's
  usage (core's `CliUsage`: model, stop reason, turns, tokens, searches, fetches, the
  CLI's cost estimate); output that is not that json is used as plain text, usage null.
  The runner sums usage over a run's sessions into the brief's `usage` in state.json.
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
- `scheduler.ts`: the daily run, inside the companion process. A failed run is retried
  once, never after a usage limit.
- `routes/interests.ts`: the interest list (with each one's brief settings) and
  `PUT /v0/interest-settings`; settings live in `state.json` under `brief_settings`.
- `service.ts`, `cli.ts`, `static.ts`: the `scout-agent` command, the macOS launchd
  service and the static file server for the bundled web app.

### Research (`packages/research/src`)

Server-side only, for the hosted plan (`docs/HOSTED-PLAN.md`); the web app never imports
it (`src/lib/boundaries.test.ts` checks this). Plain TypeScript with `fetch`.

- `research-interest.ts`: `researchInterest(interest, {claude})`, one interest's research
  as one Claude API call on Haiku with web search and web fetch. It returns the section,
  its coverage and the cost. Prompt, freshness and coverage come from core.
  Guardrails: tool versions with `max_uses` from core's `runLimits(doc)` (under the
  plan's `searches_per_run`), web_fetch capped at 3K tokens, a per-run
  spend cap (`DEFAULT_MAX_COST_USD`), and `retryable: false` on a 4xx or a limit.
  A make topic (`interest.mode === "make"`) uses core's `make-piece.ts` instead: one
  call with no tools (no search fee), `buildMakePrompt` with the intent doc and the
  "already sent" list, and `makeSectionFromAnswer`, which fails the run on no piece or
  an exact repeat. The team runner does the same through the local `claude` with
  `--tools ""`.
- `claude-client.ts`: the `ClaudeClient` seam, with a `fetch` adapter and a recorded-
  response adapter for tests, plus the relay's pair (below, "Local account relay"):
  `captureRequest` runs a function until its model call and hands back the request,
  and `replayClient` answers that one call with the Mac's text. `pricing.ts`: the price table. Every hosted function
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
  With `settings.feedback_on`, the prompt also offers a `feedback` op (core's
  `feedback.ts`): a note to the Scout team waits on a "Send feedback" card, and its
  confirm goes to the store's `sendFeedback` (SQL `send_feedback`,
  `*_feedback.sql`: 5 a reader and 200 overall a day, a free turn that skips the chat
  limit). Only admins read the `feedback` table, in Supabase. Off: the prompt is unchanged.
  With `settings.make_on`, the prompt also lets a create carry `"mode": "make"` for a
  piece Scout writes itself (`make-piece.ts`); off, the field is not offered and is
  dropped. Make mode (`*_make_mode.sql`): `interests.mode`, `interests.sent_keys` (a
  trigger adds a ready make run's piece key, keeping 60); while `make_on` is off make
  topics are never scheduled or claimed, a queued one fails, and the team runner skips
  them. Make topics count against the same topic limits.
- `publish.ts`: `createPublish({claude, store}).publish(userId, interestId)`. The
  store's `start` checks owner and limits and opens a check; the plain checks, then one
  Haiku 5.5 call; `finish` records the verdict and, on approve, sets the tags and makes
  the topic public. A check that cannot run is recorded as refused and thrown.
- `picks.ts`: `createPicks({claude, store}).refresh(limit)`: claims up to `limit`
  readers, one Haiku 5.5 call each with core's picks prompt, and stores their picks
  (none without candidates, no model call). A failed call keeps the old picks.

### Run queue (`packages/worker/src`, `supabase/migrations/*_run_queue.sql`)

Server-side only. One Cloudflare Worker (free plan) runs the hosted runs.

- SQL owns every rule: `claim_runs` reaps stale runs, stops on the kill switch
  (`settings.paused`) or the daily ceiling (`spend_today` against `daily_ceiling_usd`),
  queues due scheduled interests, and claims a batch (public interests first).
  A scheduled interest that has never run is due at once (`due_interests`), so a new
  topic gets its first brief on the next tick as a scheduled run, never spending the
  reader's Run now.
  `finish_run` records a result, its cost and its usage (tokens, searches, fetches,
  model, stop reason, requests, the largest prompt and whether one crossed the 100K
  long-prompt line, `*_usage_logging.sql`); a failed first attempt is queued again
  unless the result says a retry can't help (`p_retry`). `claim_runs` also hands each
  run its brief settings, the last two ready sections, the cadence and the date of the
  last story: `run_facts` (`*_team_run_facts.sql`), which the team's claims use too.
  `request_run` is a reader's "run now", limited by `allowance()`.
- `run-due.ts`: `runDue({queue, claude})`, one tick: claim, research each run with
  `researchInterest`, finish each. Host-neutral; tests use a stub queue.
- `supabase.ts`: the `RunQueue` adapter over PostgREST, and `requestRun` as the reader.
- `request.ts`: what every route does first: CORS, JSON answers, the bearer token, the
  reader's verified sign-in and a size-capped JSON body. `http.ts`, `voice.ts` and
  `team.ts` all use it.
- `http.ts`: `POST /runs {interestId}` with the reader's Supabase JWT; it only queues.
  `POST /chat {message}` and `POST /chat/confirm {kind, …}` verify the JWT, check
  `chat_block_reason` (kill switch, daily chat turns), and run `packages/hosted`'s chat.
  `POST /publish {interest}` verifies the JWT and runs `packages/hosted`'s publish over
  `publish_start`/`publish_finish` (`*_publish.sql`); a limit is 429
  `{error: "limit", message}`. Chat turns, picks calls and publish checks record their
  input and output tokens beside their cost.
- `chat-store.ts`: the chat's store over PostgREST with the service key. A turn's
  changes, follows and its `chat_turns` row land in one `commit_chat_turn` call
  (`supabase/migrations/*_chat.sql`, which also adds `plans.max_interests`; the
  interests trigger enforces that cap, `*_max_interests.sql`).
- `push.ts`: "Your brief is ready" and the weekly push. `finish_run` queues a
  `push_outbox` row for each device of a covered run's readers; the cron's `sendOutbox`
  sends them (aes128gcm, VAPID, via `@block65/webcrypto-web-push`) within what the tick's
  subrequest budget leaves, and deletes devices the push service calls gone (404/410).
  A push failure never fails or retries a run. Tables and RPCs: `*_push.sql`,
  `*_push_outbox.sql`. "Lots of pushes, mute some?": `mute_suggestions`
  (`*_mute_suggestions.sql`) counts a reader's pushes in the last 7 days and, from 10
  on, names up to 3 bell-on topics, least read first. The feed's notice card reads it
  through `my_mute_suggestions` (`components/hosted/MutePushes.tsx`, muting is the
  topic's bell), and the weekly push's payload carries the same titles as `mute`.
- `email.ts`: "Email me new briefs", per topic and reader (`interests.email_enabled`
  for the owner, `follows.email_enabled` for a follower, `set_topic_email`). Off until
  `settings.email_on`: then `my_topic_email` answers null and the web app hides the
  envelope toggles. A trigger on `runs` queues one `email_outbox` row per opted-in
  reader when a covered run becomes ready (finish_run and team_finish_run alike); the
  cron's `sendEmails` claims them (`claim_emails`, address from `auth.users`), holds
  each reader to 20 a day, and sends the brief as HTML and text through the
  `EmailSender` seam (Resend over fetch; no `RESEND_API_KEY`, `EMAIL_FROM` or
  `WORKER_URL`, no emails). Each email carries a signed one-click unsubscribe link,
  `GET|POST /email/unsubscribe` (HMAC keyed by the service key, `email_unsubscribe`).
  `*_email.sql`.
- Picks: each tick, after the runs, refreshes `picksBatch` readers' picks
  (`supabasePicksStore` over `claim_picks`/`finish_picks`, `*_picks.sql`). On Mondays
  the daily job marks readers active in the last 30 days (`start_weekly_picks`); their
  weekly push waits until their picks are made (at most 12 h) and then names them. A
  profile change asks for new picks, at most once a day. Picks made by an older
  `PICKS_VERSION` are stale and made again on the next tick (at most hourly). Readers
  over their spend cap are skipped and get the push with their old picks. Local
  accounts are never claimed here; their picks go through `/team/picks/*` (below).
- `index.ts`: the Worker's wiring (cron every minute, fetch). Secrets via `wrangler secret`;
  without `VAPID_PRIVATE_KEY` no pushes are sent.
- `team.ts`: the `/team` routes (paths in core's `team.ts`), with no CORS and their own
  bearer tokens; a route whose token is unset answers 404. Bodies over 192 KB are
  refused (413). `TEAM_RUNNER_TOKEN`:
  `topics`, `claim`, `start`, `runs` for the Scout team runner (below). `runs` records a
  result through `team_finish_run`, which queues the same pushes as a cron run, with the
  claude session's usage; its CLI cost goes to `runs.cli_cost_usd`, never `cost_usd`,
  so it stays out of the daily spend ceiling.
  `picks/claim` and `picks/finish` make local accounts' picks through the relay (below).
  `MODERATION_TOKEN`: `POST /team/hide {interestId, reason}` hides a public topic
  (`team_hide_interest`, logged in `moderation_log`). Hidden, never deleted.
- `voice.ts`: `POST /voice` (audio body, the reader's JWT, at most 1.5 MB) turns a clip
  into text for the setup chat's input with Workers AI's `whisper-large-v3-turbo` (the
  `AI` binding; without it the route answers 404). `begin_voice_clip`
  (`*_voice.sql`) allows 5 clips per reader per rolling 24 hours and stops everyone at
  9,000 of the free plan's 10,000 neurons a UTC day; then the reader is told to type.
  The account stays on Workers Free, where going over fails rather than bills.

### The Scout team runner (`packages/agent/src/team-runner.ts`, `pnpm team:run`)

The catalog account's public topics, researched on Håkon's Mac with the local `claude`
CLI (`research.ts` through `claude-runner.ts`, capped by `--max-turns` and a search
and fetch budget in the prompt, both from core's `runLimits(doc)`) and published through the Worker's `/team` routes, so readers
get the same briefs, notices and pushes. The Mac holds `TEAM_RUNNER_TOKEN` and
`SCOUT_WORKER_URL` in `~/.config/scout-hosted/.env`, never a Supabase key. The
companion never imports it.

- The catalog account is the team account (`profiles.is_team`); it has no interest caps.
- Team topics never run on the API: the cron's `claim_runs` always skips the team
  account's public topics, whether the runner is on or off (`*_team_runner.sql`).
- The runner is off unless both switches are on: `SCOUT_TEAM_RUNNER=on` in the shell,
  and `settings.team_runner_on` in the database. While it is off, team topics do not
  run at all. Test with `--dry-run` or the spawn stub, never a real run.
- The catalog has its own switch, `settings.team_catalog_on` (off by default,
  `*_team_catalog_switch.sql`). With only `team_runner_on`, the runner does local
  accounts alone: `mac_runs_now(owner, visibility)` keeps the team's public topics
  out of `queue_due_runs`, `claim_queued`, `team_topics` and `team_start_run` (55000),
  and `team_claim_runs` fails a queued catalog Run now ("the Scout team catalog is
  off") instead of leaving it stuck. The database decides, so the launchd service and
  any runner started by hand are local-only until the catalog is switched on.
- A team run's prompt gets what a cron run's gets (brief settings, the last two
  sections, cadence, last story), since `team_claim_runs` and `team_start_run` return
  `claim_runs`'s row. `--dry-run` has none of these and researches with the defaults.
- `interests.paused`: a paused topic is never queued by either side. The test topics
  (`seeds/team-topics.sql`) are seeded paused; `--only <topic>` is a one-off run that
  leaves it paused.
- `--dry-run` researches and prints, publishing nothing; `--list` shows the topics.
- Switching on: set the Worker secret `TEAM_RUNNER_TOKEN`, put it and the Worker URL
  in the env file (chmod 600), `update public.settings set team_runner_on = true`, then
  `SCOUT_TEAM_RUNNER=on pnpm team:run`. The catalog too:
  `update public.settings set team_catalog_on = true`.
- Local accounts (`profiles.runs_local`, set by an admin in SQL; readers cannot write
  it): every topic of theirs, private or shared, runs on the Mac instead of the API,
  with no daily run or spend cap (`*_runs_local.sql`). One SQL check,
  `runs_on_mac(owner, visibility)` (team account's public topics, or any topic of a
  local account), decides it in `queue_due_runs`, `claim_queued` and the `team_*`
  functions, so `claim_runs` never takes them. The web app shows a "Local" badge and
  "Waiting for your Mac" for a queued run (`HostedHome.runsLocal`).
- `--loop` keeps looking for due runs every 60 s, and answers local readers' picks
  (`answerDuePicks`: `/team/picks/claim`, `claude` as the gateway runs it,
  `/team/picks/finish`; a failed one is printed and its claim lapses); SIGTERM or Ctrl-C lets the run in
  progress publish, then stops. `pnpm team:run install-service` installs it as a
  launchd agent from this checkout (`team-runner-service.ts`, label
  `ing.scout.team-runner`, log `~/Library/Logs/scout-team-runner.log`);
  `uninstall-service` removes it.

### Local account relay (`packages/core/src/relay.ts`, `packages/worker/src/relay.ts`)

A local account makes no Claude API calls at all: its chat, publish check and picks
run on the Mac's `claude`. The Worker keeps every check, limit and parser; only the
model call moves. The hosted functions run unchanged: `captureRequest` stops one at its
model call, and `replayClient` reruns it with the Mac's answer, so the same parsers
decide what lands and fail closed.

- Without the relay, a local account's `/chat` message and `/publish` get 409
  `{error: LOCAL_ACCOUNT_MESSAGE}` (open Scout on the Mac). `/chat/confirm`, discard and
  every other route work as before. The cron's `claim_picks` skips local accounts.
- A relay call to `/chat` or `/publish` carries the reader's JWT, `x-scout-relay:
prompt | answer` and `x-scout-relay-token: <TEAM_RUNNER_TOKEN>`. Wrong token: 401;
  the token unset on the Worker: 404; a reader who is not local: 403.
- `prompt` (the route's normal body): the Worker checks the limits, begins the turn
  (`begin_chat_turn`, `publish_start`) and answers 200 `{turnId, request}` with the
  response header `x-scout-relay: prompt`. `request` is the Messages API body to give
  `claude`. With no such header, no model call was needed and the body is the route's
  normal answer.
- `answer` `{turnId, text, usage?, stopReason?}` (at most 192 KB): the Worker reruns
  the turn with `text` as the model's answer and returns the route's normal answer.
  Cost is recorded as 0; tokens are kept. A chat turn must still be pending and at most
  10 minutes old, and a publish check open and at most 10 minutes old
  (`publish_relay_start`). Otherwise the answer gets 409.
- Picks (`TEAM_RUNNER_TOKEN` as bearer): `POST /team/picks/claim {limit?}` (at most 5)
  claims due local readers (`team_claim_picks`, only while the team runner is on, no
  spend gate) and returns `{prompts: [{turnId, request}]}`; `turnId` is the picks run.
  `POST /team/picks/finish` with a `RelayAnswer` replays it and calls `finish_picks`
  at cost 0, answering `{stored}`. A claim is open for an hour (`team_pick_job`; 404
  after that).
- SQL: `*_local_relay.sql` (`claim_due_picks`, `team_claim_picks`, `team_pick_job`,
  `publish_relay_start`), tested in `supabase/tests/local_relay.test.sql`.

### Local Scout on the Mac (`scripts/local-serve.mjs`, `scripts/local-gateway.mts`, `pnpm local:serve`)

The hosted web app, the same code as the test site, served from the Mac Mini at
<https://openhakons-mac-mini.taildc1287.ts.net:47900>, tailnet only, for the founder's
local account. It talks to the same Supabase project, and to the Worker through the
gateway, so every model step runs on the Mac's `claude` (the founder's subscription).

- The gateway (`scripts/local-gateway.mts`) is one origin on 127.0.0.1:47900 (not
  47821, the companion; not 47899, the demo). GET and HEAD are the built site,
  served by `scripts/local-server.mjs` the way Pages does, with the build's `_headers`
  (the filled-in CSP). Every other request goes to the Worker server to server
  (`createWorkerProxy`, `packages/agent/src/local-relay.ts`).
- The Mac's build (`buildIdeas(env, {worker: LOCAL_ORIGIN})`) sets the app's Worker URL
  to the gateway's own origin, so the app's code is unchanged.
- `POST /chat` and `POST /publish` go through the relay ("Local account relay"): the
  prompt step with the reader's JWT and `TEAM_RUNNER_TOKEN`; if the answer carries
  `x-scout-relay: prompt`, its `request` runs through `claude-runner.ts` (no tools,
  `--model haiku`, `--json-schema` from the request, 90 s, one turn at a time), then
  the answer step; the browser gets the Worker's final answer unchanged. Without that
  header the first answer passes through. If `claude` fails, times out or hits its
  usage limit: 503 `{error}`, a plain sentence the app shows. Relay headers a browser
  sends are dropped.
- The gateway reads `TEAM_RUNNER_TOKEN` and `SCOUT_WORKER_URL` from
  `~/.config/scout-hosted/.env` (`scripts/hosted-config.mts`), never into
  `process.env`, never logged.
- `pnpm local:serve` builds, copies the site to
  `~/Library/Application Support/Scout Local/site` (so `pnpm build`, which also writes
  `out/`, never changes what is served) and (re)starts the LaunchAgent
  `ing.scout.local-web` (log `~/Library/Logs/scout-local-web.log`). The job runs the
  gateway from this checkout with its `tsx`, like the team runner's service, with a
  PATH that reaches `claude`. `pnpm local:serve install` skips the build;
  `pnpm local:serve uninstall` stops it. The build needs `SUPABASE_ACCESS_TOKEN` from
  the shell or the env file.
- Picks for local readers come from `pnpm team:run --loop` (`answerDuePicks`), not the
  gateway.
- The Worker allows the origin: it is the second entry of `ALLOWED_ORIGIN`
  (`wrangler.toml`); the first stays the email site URL.
- Turning it on, once: the Worker deployed with the relay and that `ALLOWED_ORIGIN`;
  the Worker secret `TEAM_RUNNER_TOKEN`; `TEAM_RUNNER_TOKEN` and `SCOUT_WORKER_URL` in
  the env file (chmod 600); the migrations through `*_team_catalog_switch.sql`
  (`pnpm db:push:hosted`); `update public.settings set team_runner_on = true` (leave
  `team_catalog_on` off: the catalog's topics stay off the Mac) and
  `update public.profiles set runs_local = true where id = '<founder>'`;
  `pnpm team:run install-service`; `pnpm local:serve`;
  `tailscale serve --bg --https=47900 http://127.0.0.1:47900`; and
  `https://openhakons-mac-mini.taildc1287.ts.net:47900/app/signin/` in the Supabase
  Auth redirect URLs.

### Signing in on the Mac (`packages/agent/src/local-signin.ts`, `packages/worker/src/local-session.ts`)

On the Mac's Scout the founder is signed in to the Scout team account without an
email or a password. It is a local account (`profiles.runs_local`) named "Scout team"
in Supabase Auth (`user_metadata.display_name`), with the placeholder address
`scout-team@local.scout.invalid` (`.invalid` is reserved: no mail can reach it).

- The Mac's build (`buildIdeas(env, {localSignin: true})`, so
  `NEXT_PUBLIC_SCOUT_LOCAL_SIGNIN=1`) has no sign-in choices: the sign-in page sends a
  signed-out reader to `GET /local-signin` on the gateway, and a signed-in one to the
  brief. Signing out leads back to it, so on this origin it signs straight in again.
- The gateway answers `/local-signin` itself (`startLocalServer`'s `routes`) only for
  the tailnet owner: `Tailscale-User-Login` must equal `SCOUT_LOCAL_ALLOWED_LOGIN`
  (case-insensitive). No login set, no header or another login: 403, and the Worker is
  not asked. `tailscale serve` fills that header from the requester's identity and
  strips any copy a client sent; tagged devices and Funnel traffic get none
  (<https://tailscale.com/kb/1312/serve>, "Identity headers"). The gateway binds
  127.0.0.1 only, so from another machine the one way in is `tailscale serve`. A
  process on the Mac itself could set the header, but it could also read the env file.
- Then it calls the Worker's `POST /team/local-session` (bearer `TEAM_RUNNER_TOKEN`;
  wrong token 401; token or service key unset 404; no CORS) and redirects to
  `/app/signin/#access_token=…&refresh_token=…&expires_in=…&token_type=bearer`, the
  implicit flow's fragment, so `auth.ts` stays the only owner of the session.
- The Worker, with the service key that never leaves it: creates the user once
  (`/auth/v1/admin/users`, `email_confirm`; later calls get 422 `email_exists`), mints a
  magic link's token hash with `/auth/v1/admin/generate_link` (returned, never mailed),
  spends it at `/auth/v1/verify` for a fresh session, and sets `runs_local = true` on
  every call. Supabase Auth checks only the address's format there; its deliverability
  checks run only when it sends mail.
- `profiles.display_name` stays empty: the reserved-name check
  (`is_reserved_name`, `*_profile.sql`) refuses "Scout team" on a profile.
- The account on the test site needs nothing: it has no way to sign in there, and a
  local account's `/chat` and `/publish` get 409 anyway.
- Turning it on: the Worker deployed with this route; `SCOUT_LOCAL_ALLOWED_LOGIN=<your
Tailscale login>` in `~/.config/scout-hosted/.env` (read by `hosted-config.mts`,
  never printed); `pnpm local:serve`. The first sign-in creates the account.

### Web app (`src`)

- `app/`: pages. `app/app/page.tsx` is the feed, `app/app/connect` is onboarding and
  pairing, and `app/app/profile` holds the interest chat and intent docs.
- `lib/companion.ts`: finds the companion (same origin first, then a loopback port sweep)
  and makes every call through `companionFetch`/`companionJson`. It also adapts briefs
  into feed articles and holds the start-a-run-and-wait loop.
- `lib/chat.ts`, `lib/interest-docs.ts`, `lib/run-failure.ts`: chat turns, the reader's
  interest list, and the "your run failed" banner.
- `lib/storage.ts`, `lib/safe-storage.ts`, `lib/likes.ts`: browser storage. Every write
  goes through `safe-storage`. Likes are keyed per reader: `setLikesUser(id, sync)` on
  each sign-in loads them from `story_marks` (`likesSync(hostedData)`); likes made
  signed out move into the account at the next sign-in and leave the device, and
  sign-out drops the reader's local copy.
  `startHostedLikes()` (called from the shell's `TopPills` on every /app screen) wires
  this to `onAuthChange` through `followLikes`.
- `lib/auth.ts`: hosted sign-in (Google or an email link) and the only place the
  Supabase client and session live. Interface: `hostedAuth()` returns `currentUser`,
  `signInWithGoogle`, `sendMagicLink`, `signOut`, `onAuthChange`, or null when the build
  has no `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Every sign-in
  comes back to `app/app/signin` (implicit flow: tokens in the URL fragment, read by the
  client), so the static export needs no callback route. Errors reach the page as
  plain sentences.
- `lib/hosted.ts`: the hosted app's one data module. `hostedData()` returns `home`,
  `transcript`, `chat`, `confirm`, `setCadence`, `setBriefSettings`, `remove`,
  `restore`, `unfollow`,
  `runNow`, and for sharing `setVisibility`, `shared(slug)`, `follow(slug)`,
  `hostCopy(notice)` and `dismiss(notice)`, and `pushStatus`, `pushEnable`,
  `pushDisable` for this device's notifications, `publish`, `setTags`, `browse`,
  `tagCounts`, `report`, `profile`, `setProfile`, `marks`/`mark`/`unmark` (likes and
  saves), `sendEvents` (usage, in batches of 50), and `picks`/`dismissPick` (the
  reader's cached picks), over Supabase REST (as the reader,
  under RLS) and the Worker. `shared` and `browse` also work signed out, with the anon key. Limits come
  back as `HostedError` with a plain sentence (core's `quotaMessage`, shared with the
  Worker). Pausing a topic is its cadence `off` (not `interests.paused`, the
  host's or team's switch): the daily and weekly caps count only topics that are not
  off, so a pause frees its slot at once. One module, `PauseButton.tsx`, pauses and
  resumes in Settings' Topics group, on each own topic's card in Topics and on the
  topic's page; it shows the change at once (`withCadence`) and the reload after the
  write puts the server's state back. Resume (`resumeSlot`) gives back the topic's `last_cadence` when that slot is free,
  else the other free one (weekly first when nothing is remembered), else it stays
  paused and says "No free weekly slot. Pause another topic or upgrade." (or daily).
  `components/hosted/` renders it; in a hosted build `app/app/page.tsx` shows
  `HostedHome` instead of the companion feed. `app/i` is a share link's page
  (`/i/?s=<slug>`, read on the client because the site is a static export): the
  interest's latest brief for anyone, and Follow for a signed-in reader.
  `lib/hosted.ts` is only the entry callers import: it composes `lib/hosted/`, one
  module per area over one client. `client.ts` (session, REST as the reader, Worker
  calls, `HostedError` wording), `home.ts` (the feed and one interest's edits),
  `chat.ts`, `sharing.ts` (links, follows, notices), `catalog.ts` (publish, tags,
  browse, reports, picks), `account.ts` (profile, time zone, usage, delete),
  `marks.ts` (likes and saves, `likesSync`), `push.ts` (this device and per-topic
  push and email, and `muteSuggestions`) and `types.ts`. Each method lives in exactly one area
  (`lib/hosted-split.test.ts`); `lib/hosted-fake.ts` implements the same
  `HostedData` for screenshots and e2e.
- `components/FeedBody.tsx`: a story's body as markdown (GFM tables too) through
  rehype-sanitize, never raw HTML; body images are dropped (only the lead image shows,
  with no referrer) and links get `rel="nofollow ugc noopener"`.
- `lib/seo.ts`: search indexing, decided only here. Every page is noindex (the root
  layout) except the landing, Browse and `/i/`, and those only in a build with
  `SCOUT_INDEXED_SITE` set to the real site's URL; `/i/` adds noindex on the client
  unless the topic is a public Scout team topic. `pnpm deploy:ideas` clears the switch,
  so the test site is noindex throughout. `app/robots.ts` and `app/sitemap.ts` (the
  landing and Browse) come from it too.
- `public/_headers`: the hosted site's Content-Security-Policy on Cloudflare Pages.
  `scripts/csp-headers.mjs` fills in the Supabase and Worker origins and a hash of each
  inline script after the build (`pnpm deploy:ideas`), so `script-src` has no
  `'unsafe-inline'`.
- `public/manifest.webmanifest` and `public/sw.js`: installing Scout as a web app (iPhones
  get pushes only from the Home Screen) and the service worker that shows pushes and
  opens `app/` on a tap. Both use relative URLs, so they work under any base path. No
  offline caching. The switch is `components/hosted/PushSwitch.tsx`.

### Hosted backend (`supabase/`)

The hosted plan's schema, RLS and `allowance()` (`migrations/`), with pgTAP tests in
`tests/` (`pnpm test:rls`, against `supabase start`). A trigger on `auth.users` creates
each new account's profile row (free plan, UTC). `*_sharing.sql` adds sharing: an
interest is private, shared (anyone with the link may follow) or public (the catalog;
only `profiles.is_admin` may set it), through `set_visibility`. Followers read the
host's runs, at no cost to them. `follow(slug)`, `interest_by_slug(slug)` (anon too)
and `host_copy(notice)` are the RPCs; when a host makes a followed interest private or
deletes it, a trigger leaves each follower a `stopped_sharing` notification and drops
the follows. `*_push.sql` keeps one row per device for push notifications; a reader
sees and deletes only their own, and the Worker reads them through `push_targets`.
`seeds/public-interests.sql` is the starter catalog and `seeds/team-topics.sql` the
Scout team's paused test topics, both applied by hand. A hidden topic
(`interests.hidden_at`) leaves the catalog, share links and the chat's suggestions.
`*_publish.sql`: going public only through the Worker's check (`publish_checks`; at
most 3 public, 5 checks a rolling day, 24 h before republishing); a topic or doc edit
drops a public topic to shared, a tag edit (`set_topic_tags`) does not. Each check's
Haiku cost counts toward the spend caps (`*_publish_spend.sql`).
`*_usage.sql`: `story_marks` (likes, saves) and `usage_events` (story clicks, brief
views, seconds per story; own insert only, 300 an hour, deleted after 30 days by
`cleanup_runs`), which feed `topic_popularity`. `*_browse.sql`: `browse_topics`
(full-text on title and tags, tag filter, popular or new), `tag_counts`, and
`report_topic` into the admin-only `topic_reports`. `*_profile.sql`: optional location,
student, role and liked tags, and `is_reserved_name` for display names.
`*_picks.sql`: `reader_picks` (one cached ranking per reader, up to 5 topics with a
reason), `dismissed_picks`, and `pick_runs`, whose cost counts toward the spend caps.
`my_picks` returns only topics still public, not owned, followed or dismissed, from
picks of the current `picks_version()` (core's `PICKS_VERSION`; bump both together).
The web app checks each cached reason again against `my_picks_reader` before showing it.
`*_payments.sql`: plan prices and a `subscriptions` table, unused until payments.
The plans table and `src/lib/plans.ts` (what the screens show) hold the same prices and
limits; `test/plans-parity.test.mjs` fails when they differ, so a change to one needs
a migration or an edit to the other.
`config.toml` turns on Google (client
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
- `supabase/tests`: pgTAP tests for RLS, quotas, the sign-up trigger, the run queue, chat,
  sharing, push devices, usage events, the profile and subscriptions. `pnpm test:sql`
  runs them in PGlite (part of `pnpm check`); `pnpm test:rls` against Docker.
- `test/*.test.mjs`: script tests, and `sql-parity.test.mjs`, which checks that core and
  the schema agree on tags and the topic length, and `plans-parity.test.mjs` (plans.ts
  against the plans table), both in PGlite with no network.
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
