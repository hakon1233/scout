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
- `tags.ts`: the 30 seed tags (browse's chips, the publish check's first choice) and
  `normalizeTags`; the SQL's `tags_ok` enforces the same pattern.
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
  Guardrails: tool versions with `max_uses`, web_fetch capped at 6K tokens, a per-run
  spend cap (`DEFAULT_MAX_COST_USD`), and `retryable: false` on a 4xx or a limit.
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
  `finish_run` records a result and its cost; a failed first attempt is queued again
  unless the result says a retry can't help (`p_retry`). `claim_runs` also hands each
  run its brief settings, the last two ready sections, the cadence and the date of the
  last story (`*_brief_settings.sql`).
  `request_run` is a reader's "run now", limited by `allowance()`.
- `run-due.ts`: `runDue({queue, claude})`, one tick: claim, research each run with
  `researchInterest`, finish each. Host-neutral; tests use a stub queue.
- `supabase.ts`: the `RunQueue` adapter over PostgREST, and `requestRun` as the reader.
- `http.ts`: `POST /runs {interestId}` with the reader's Supabase JWT; it only queues.
  `POST /chat {message}` and `POST /chat/confirm {kind, …}` verify the JWT, check
  `chat_block_reason` (kill switch, daily chat turns), and run `packages/hosted`'s chat.
  `POST /publish {interest}` verifies the JWT and runs `packages/hosted`'s publish over
  `publish_start`/`publish_finish` (`*_publish.sql`); a limit is 429
  `{error: "limit", message}`.
- `chat-store.ts`: the chat's store over PostgREST with the service key. A turn's
  changes, follows and its `chat_turns` row land in one `commit_chat_turn` call
  (`supabase/migrations/*_chat.sql`, which also adds `plans.max_interests`; the
  interests trigger enforces that cap, `*_max_interests.sql`).
- `push.ts`: "Your brief is ready" and the weekly push. `finish_run` queues a
  `push_outbox` row for each device of a covered run's readers; the cron's `sendOutbox`
  sends them (aes128gcm, VAPID, via `@block65/webcrypto-web-push`) within what the tick's
  subrequest budget leaves, and deletes devices the push service calls gone (404/410).
  A push failure never fails or retries a run. Tables and RPCs: `*_push.sql`,
  `*_push_outbox.sql`.
- Picks: each tick, after the runs, refreshes `picksBatch` readers' picks
  (`supabasePicksStore` over `claim_picks`/`finish_picks`, `*_picks.sql`). On Mondays
  the daily job marks readers active in the last 30 days (`start_weekly_picks`); their
  weekly push waits until their picks are made (at most 12 h) and then names them. A
  profile change asks for new picks, at most once a day. Readers over their spend cap
  are skipped and get the push with their old picks.
- `index.ts`: the Worker's wiring (cron every minute, fetch). Secrets via `wrangler secret`;
  without `VAPID_PRIVATE_KEY` no pushes are sent.
- `team.ts`: the `/team` routes (paths in core's `team.ts`), with no CORS and their own
  bearer tokens; a route whose token is unset answers 404. `TEAM_RUNNER_TOKEN`:
  `topics`, `claim`, `start`, `runs` for the Scout team runner (below). `runs` records a
  result through `team_finish_run`, which queues the same pushes as a cron run.
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
budget in the prompt) and published through the Worker's `/team` routes, so readers
get the same briefs, notices and pushes. The Mac holds `TEAM_RUNNER_TOKEN` and
`SCOUT_WORKER_URL` in `~/.config/scout-hosted/.env`, never a Supabase key. The
companion never imports it.

- The catalog account is the team account (`profiles.is_team`); it has no interest caps.
- Team topics never run on the API: the cron's `claim_runs` always skips the team
  account's public topics, whether the runner is on or off (`*_team_runner.sql`).
- The runner is off unless both switches are on: `SCOUT_TEAM_RUNNER=on` in the shell,
  and `settings.team_runner_on` in the database. While it is off, team topics do not
  run at all. Test with `--dry-run` or the spawn stub, never a real run.
- `interests.paused`: a paused topic is never queued by either side. The test topics
  (`seeds/team-topics.sql`) are seeded paused; `--only <topic>` is a one-off run that
  leaves it paused.
- `--dry-run` researches and prints, publishing nothing; `--list` shows the topics.
- Switching on: set the Worker secret `TEAM_RUNNER_TOKEN`, put it and the Worker URL
  in the env file (chmod 600), `update public.settings set team_runner_on = true`, then
  `SCOUT_TEAM_RUNNER=on pnpm team:run`.

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
  each sign-in loads them from `story_marks` (`likesSync(hostedData)`); device likes
  made signed out are never uploaded, and sign-out drops the reader's local copy.
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
  Worker). `components/hosted/` renders it; in a hosted build `app/app/page.tsx` shows
  `HostedHome` instead of the companion feed. `app/i` is a share link's page
  (`/i/?s=<slug>`, read on the client because the site is a static export): the
  interest's latest brief for anyone, and Follow for a signed-in reader.
- `components/FeedBody.tsx`: a story's body as markdown (GFM tables too) through
  rehype-sanitize, never raw HTML; body images are dropped (only the lead image shows,
  with no referrer) and links get `rel="nofollow ugc noopener"`.
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
drops a public topic to shared, a tag edit (`set_topic_tags`) does not.
`*_usage.sql`: `story_marks` (likes, saves) and `usage_events` (story clicks, brief
views, seconds per story; own insert only, 300 an hour, deleted after 30 days by
`cleanup_runs`), which feed `topic_popularity`. `*_browse.sql`: `browse_topics`
(full-text on title and tags, tag filter, popular or new), `tag_counts`, and
`report_topic` into the admin-only `topic_reports`. `*_profile.sql`: optional location,
student, role and liked tags, and `is_reserved_name` for display names.
`*_picks.sql`: `reader_picks` (one cached ranking per reader, up to 5 topics with a
reason), `dismissed_picks`, and `pick_runs`, whose cost counts toward the spend caps.
`my_picks` returns only topics still public, not owned, followed or dismissed.
`*_payments.sql`: plan prices and a `subscriptions` table, unused until payments.
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
  sharing and push devices
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
