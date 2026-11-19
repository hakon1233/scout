# Scout hosted: architecture plan

Status: proposal for Håkon, 20 Nov 2026. Branch `ideas`; `main` stays the local version.

## 1. Product

Scout is a website where you tell an AI what you want to follow, and every morning (or once a
week) it reads the web for you and writes a short brief: dated stories from primary sources,
newest first, each with a few paragraphs of depth. You set up each **interest** by chatting.
You can follow interests that Håkon curates (free), or share your own by link so friends get
the same brief. Free accounts get a few scheduled interests; a paid plan later raises the limits.

**User journey**
1. **Sign in**: Google, or email with a confirmation link.
2. **First interest by chat**: "What do you want to follow?" The chat drafts the intent doc.
   If a public interest matches, it offers "Follow *AI policy* (curated)" instead.
3. **First brief**: the run starts at once (1–3 min, with a progress line); the brief opens when done.
4. **Schedule**: each interest is daily, weekly or paused, at a time you choose; quota shown ("2 of 3 daily").
5. **Follow / share**: "Share" gives a link; whoever opens it can follow; followers read the
   host's brief at no cost to themselves.

## 2. Architecture

### Hosting choice

| Option | Time limit per call | Fit |
|---|---|---|
| **Supabase Edge Functions + pg_cron** | 150 s free, **400 s paid**; 2 s CPU, async I/O excluded [S1] | One interest per call fits in 400 s. Auth, DB, cron and functions on one platform. Deno, not Node. |
| Vercel function + Vercel cron | 300 s Hobby; 800 s Pro [V1]. Hobby cron is once a day with ±59 min precision [V2] | Needs Pro for minute cron. Adds a second backend platform. |
| Small Node worker (Fly/Railway) | none | Reuses Node code as is, but adds a server to run, deploy, watch and keep alive. |

**Recommendation: Supabase Pro.**
- Use Supabase for auth, Postgres, pg_cron and two Edge Functions (`run`, `chat`).
- The web app stays a static Next.js export, hosted on GitHub Pages now and on any static host later.
- **One run = one interest = one function call**, which keeps each call well under 400 s:
  - `max_uses` caps searches;
  - a 300 s client timeout ends the call before the platform does and marks the run failed.
- The free Supabase plan (150 s) is too tight, and free projects pause when idle. So Pro
  (about $25/month) is the first fixed cost.
- **Escape hatch:** if runs grow past ~5 minutes, move only the `run` function to a Node
  worker that reads the same queue. Nothing else changes.

### Data model (all tables RLS on, deny by default)

| Table | Holds | RLS |
|---|---|---|
| `profiles` | `id = auth.uid`, `plan`, `timezone`, `is_admin` | Read and update your own row, except `plan` and `is_admin`. |
| `plans` | One row per plan: the limits (§3) | Readable by signed-in users; no client writes. |
| `settings` | One row: global daily dollar ceiling, model id, kill switch | No client access. |
| `interests` | `owner_id`, `topic`, `doc` (intent doc), `cadence` (daily, weekly or off), `run_at`, `visibility` (private, shared or public), `share_slug`, `deleted_at` | Owner: full access. Others: read only if you follow it, or through the `interest_by_slug` RPC. |
| `follows` | `user_id`, `interest_id` | Your own rows. Inserted only through the `follow` RPC (which checks visibility). |
| `runs` | `interest_id`, `status` (queued, running, ready or failed), `scheduled_for`, `section_md`, `coverage`, `searches`, `cost_usd`, `error_msg` | Read if you can read the interest. Writes: service role only. |
| `chat_turns` | `user_id`, `message`, `reply`, `changes`, `pending`, `status`, `cost_usd` | Your own rows. Writes go through the `chat` function. |
| `notifications` | `user_id`, `kind`, `payload` (snapshot of topic and doc), `read_at` | Your own rows. Clients may update `read_at` only. |

**A brief is a query, not a table.** "Today's brief" is:
- the latest ready run of each interest you own or follow;
- assembled in the browser by the existing `assembleBrief` and `parseBrief`.

The weekly brief comes from the same runs over 7 days (`createWeeklyBriefFromHistory`). This
removes brief storage, brief merging and the per-user copy of shared briefs.

### Deep modules

| Module | Interface | Hides |
|---|---|---|
| **`core`** (pure TS package, no Node or Deno APIs; imported by web and functions) | The existing functions: `SEARCH_SKILLS`, `ASSEMBLY_SKILLS`, `buildResearchPrompt`, `computeCoverage`, `enforceBriefFreshness`, `assembleBrief`, `parseBrief`, `createWeeklyBriefFromHistory`, change-set validation, contract types | Scout's whole brief grammar and rules. Already Node-free today: coverage, brief-document, assembly and search skills, chat-changes, weekly, contract, limits. |
| **`researchInterest(interest, {claude}) → {sectionMd, coverage, usage}`** | One call | The Messages API call on `claude-haiku-5-5`:<br>- web_search and web_fetch tools, `max_uses`;<br>- the cached system prefix (search skills);<br>- `pause_turn` continuation and the 300 s timeout;<br>- tool errors returned in a 200;<br>- freshness enforcement and preamble stripping;<br>- dollar cost from `usage`.<br>Seam: a `ClaudeClient` with two adapters (Anthropic SDK and a test stub), so it is a real seam. Replaces `claude-runner` plus `research`. |
| **Run queue** (SQL `enqueue_due_runs(now)` + `run` function) | pg_cron calls `enqueue_due_runs` every minute. For each queued run, pg_net POSTs `{runId}` to `run`. | Due-time maths per timezone. Checks for quota, the global ceiling and the kill switch. Single flight per interest (unique queued or running run). One retry for a failed run. |
| **`allowance(user)`** (one SQL function) | Returns `{plan, used, limits}` | All limit logic. Used by the interest-cadence trigger, `enqueue_due_runs`, on-demand runs, the chat and the UI quota line. **The only place limits are read.** |
| **`chatTurn(user, message) → ChatTurn`** (`chat` function) | One call | Today's chat prompt:<br>- the interest snapshot plus the public catalog;<br>- a change set as structured output;<br>- validation by `core`;<br>- pending delete or rewrite held until you confirm;<br>- applied in one transaction.<br>Adds the op `follow`. |
| **Sharing RPCs** (`set_visibility`, `follow`, `host_copy`) | Three calls | Slug minting, follow rules, the notification trigger, copying a stopped interest onto your own quota. |
| **Web `data.ts`** (replaces `lib/companion.ts`) | `interests`, `feed(day)`, `runNow`, `chat`, `notifications` … | supabase-js, auth session, polling of a run until it is ready. The only data module the UI imports (boundaries test updated). |

### Reused vs dropped

- **Reused as is:**
  - the search and assembly skills;
  - coverage, brief-document, weekly and the change-set validation;
  - the contract types (as row and response shapes);
  - the feed UI (FeedView, FeedBody, BriefLayout, BriefHistory, LikeButton);
  - the chat diff UI, the sample brief and the eval harness.
- **Ported:**
  - `research.ts` and the chat prompt in `chat-model.ts` (prompt text kept, `claude` CLI swapped for the API);
  - the schedule UI, now per interest;
  - `limits.ts`, whose values move into the `plans` table.
- **Dropped:**
  - the companion server and its routes, pairing token, `claude-runner`, cli, service/launchd, static server;
  - `state.ts` / `persistence.ts` (Postgres replaces them), the in-process scheduler, and the loopback discovery in the web app.
  - Likes stay in localStorage for now.

## 3. Quotas and costs

**Limits live in one place: the `plans` table**, read only through `allowance()`:

```json
{ "id": "free", "daily_interests": 3, "weekly_interests": 10, "on_demand_runs_per_day": 3,
  "chat_turns_per_day": 40, "searches_per_run": 5, "max_doc_chars": 4000 }
```

- Changing a number is one SQL update, with no deploy.
- Paid later means a `pro` row plus a payment webhook that sets `profiles.plan`.
- `settings` holds the global `daily_ceiling_usd` (start at $10) and a kill switch.

**Prices** [P1] [P2]:
- Haiku 5.5: $0.10 per M input tokens, $0.50 per M output (prompts ≤100K tokens), cache hits $0.01 per M.
- Web search: $10 per 1,000 searches. Failed searches are free; results count as input tokens.
- Web fetch: tokens only.

**Cost of one interest run** (estimate; measure it in task 4):

| Item | Amount | Cost |
|---|---|---|
| Searches | ~4–5 | $0.040–0.050 |
| Input tokens (results and pages re-read across steps) | ~120K | $0.012 |
| Output tokens (thinking and section) | ~6K | $0.003 |
| **Total per run** | | **≈ $0.055–0.065**, three quarters of it search |

**Cost of one free user per month:**

| Free plan | Runs/month | Cost/month |
|---|---|---|
| 3 daily + 10 weekly (the proposal) | 90 + 43 = 133 | **≈ $7.50** |
| 1 daily + 3 weekly | 30 + 13 = 43 | ≈ $2.50 |
| Following only (public or shared) | 0 | $0 |

A chat turn costs well under $0.01 (no tools).

**Levers:**
- Following costs nothing, so steer people to public interests.
- Fewer searches per run, set in `searches_per_run`.
- The Batches API (half price, but it throttles searches, so only for weekly runs).

**Hard ceilings**, all four enforced:
1. **Per user:** `allowance()`.
2. **Per run:** `max_uses` plus a 300 s timeout.
3. **Global:** the sum of today's run and chat `cost_usd` against `daily_ceiling_usd`. When over, new runs wait ("paused: capacity") and chat says so.
4. **Backstop:** a monthly spend limit on the Anthropic workspace.

## 4. Sharing model

**States** (`visibility`):
- `private`: owner only.
- `shared`: anyone with the link can follow. Runs on the host's quota.
- `public`: set only by an admin (Håkon). Listed in the catalog and offered by the chat. Runs on no one's quota (house cost).

**Follow:**
- Opening `/i/<slug>` shows the latest brief and a Follow button. The slug is random, 20+ characters.
- The followed interest's runs show up in your feed.
- Following never counts against your quota. You can't edit what you follow.

**Host stops sharing** (sets it private, or deletes it):
- A trigger removes the follow rows.
- It writes one notification per follower, with a snapshot of the topic and intent doc:
  "Anna stopped sharing *Rust compilers*. [Host it yourself] [Dismiss]".
- **Host it yourself** calls `host_copy`. It makes your own private interest from the snapshot,
  checked by `allowance()`; if you are over quota, it says so and offers weekly.
- A deleted interest is soft-deleted (`deleted_at`), so past runs still show in history.

**Simplest notification:** a bell with an unread count.
- It reads `notifications` on page load and on focus. No realtime, no email.
- In Phase 1 there are only three kinds: stopped sharing, run failed twice, over quota.

## 5. Security

- **RLS everywhere, deny by default.**
  - Clients read through RLS. Writes happen only through RPCs (`security definer`, checking `auth.uid()`) or functions.
  - `runs`, `plans`, `settings` and costs are never client-writable.
  - Task 2 adds RLS tests that sign in as two users and try each cross-read.
- **Secrets:**
  - The Anthropic key and the service-role key live only in Supabase function secrets. The browser gets the anon key only.
  - pg_net calls to `run` carry a shared secret header kept in Vault.
- **Prompt injection from fetched pages:**
  - The research call's only tools are read-only (search and fetch), and its context holds no
    secrets or user data (only the topic and intent doc). A hijacked run can at worst write a bad section.
  - The output is markdown. Render it with the existing parser: no raw HTML, links http(s) only.
  - Story images are third-party URLs that reveal the reader's IP to that host. Use
    `referrerpolicy=no-referrer` now; proxy or drop them later.
  - A host's intent doc shown to followers is rendered as plain text.
- **Chat:** model output is only a proposed change set. `core` validates it and RLS bounds it,
  so a prompt can never touch another user's rows.
- **Abuse:**
  - Email confirmation, plus Turnstile or hCaptcha on email sign-up (built into Supabase Auth).
  - Per-user chat and on-demand caps. `max_doc_chars`. The global ceiling and kill switch.
  - Share slugs that can't be guessed, and RPC rate limits.

## 6. Phased build (Phase 1, in order; each is one subagent job)

1. **`core` package:** move the pure modules out of `packages/agent` with their tests. No behaviour change.
2. **Supabase schema:**
   - tables, RLS, the `plans` and `settings` seed, `allowance()`;
   - RLS tests against local `supabase start`.
3. **Auth:** Google plus email confirmation, a sign-in page, and a profile row on sign-up.
4. **`researchInterest`:**
   - the API adapter and a stub adapter;
   - tests with recorded responses;
   - `pnpm eval` on its output;
   - one real measured run, to confirm the cost per run.
5. **Run queue:** `enqueue_due_runs`, pg_cron and pg_net, the `run` function, ceiling and kill switch, cost ledger.
6. **`chat` function:**
   - port the prompt to structured output;
   - pending delete and rewrite confirmations;
   - the `follow` op and the public catalog in the prompt.
7. **Web `data.ts`:** replace the companion client; the feed is built from runs; update the boundaries test.
8. **First-run UI:** sign in, chat, first brief with a progress line, plus the quota line and per-interest schedule.
9. **Sharing:** visibility, the `/i/<slug>` page, follow, the stop-sharing trigger, `host_copy`, the bell.
10. **Public catalog:** an admin flag lets Håkon mark interests public; house runs skip quota.
11. **Deploy for `ideas`:**
    - CI runs migrations and function deploys on the ideas Supabase project, and the web build to the preview;
    - e2e against local Supabase with the stub Claude.

**Phase 2+ (parked):** each idea, and what would show we need it.

| Idea | What would show the need |
|---|---|
| Payments and a `pro` plan | Free users hit quota and ask for more. |
| Email and push digests | Users stop returning to the site after week 1. |
| Memory and dedup across days | Users complain about repeat stories. |
| Faster runs (parallel or streamed sections) | First-brief drop-off during the 1–3 min wait. |
| Native web-view app | Users ask for a home-screen app. |
| Image proxy | Privacy complaints, or broken images. |
| Realtime notifications | People wait on a page for a run to finish. |
| Public catalog search with embeddings | More than ~50 public interests. |
| Node worker for runs | Runs near the 400 s limit. |

## 7. Complexity verdict

| Piece | Verdict | Drivers | Simpler alternative |
|---|---|---|---|
| `core` extraction | **Low** | The code is already pure. | None needed. |
| Schema and RLS | **Medium** | Follow visibility rules, and RLS tests. | Fewer tables (done: briefs are a query). |
| Auth | **Low** | Supabase does it. Google needs an OAuth client set up. | Email only at first. |
| `researchInterest` | **Medium** | Tool loop edge cases (`pause_turn`, errors in a 200), the new tokenizer, keeping output inside the grammar. | Basic `web_search_20250305` without dynamic filtering if Haiku misbehaves. |
| Run queue | **Medium** | Timezones, single flight, retries, ceiling. | One cron per hour that runs everything due (coarser times). |
| Chat function | **Medium** | Structured output port, pending confirmations. | Drop rewrite confirmation in Phase 1 (keep delete). |
| Sharing and notifications | **Medium** | The stop-sharing flow and snapshots. | Phase 1 without "host it yourself": the notification only. |
| Cost control | **Low–Medium** | A cost ledger per call. | Rely on the Anthropic spend limit alone (blunt: stops everyone). |

**Overall: Medium.** About 11 subagent jobs. The riskiest pieces are the research adapter's
output quality on Haiku 5.5 and the cost per run. Both are measured in task 4, before the UI work.

## 8. Open questions

1. **Free limits.** 3 daily + 10 weekly costs about $7.50 per active user per month.
   **Recommend:** start at 1 daily + 3 weekly (about $2.50) and raise it once real costs are measured.
2. **Supabase Pro (about $25/month) from day one?** **Recommend yes:** the free plan's 150 s
   limit is too tight for runs, and free projects pause when idle.
3. **Static web host.** **Recommend:** keep GitHub Pages for the `ideas` preview. Move to
   Cloudflare Pages or Vercel when payments and a domain arrive, since Pages isn't meant for a commercial service.
4. **Sign-in.** **Recommend:** Google plus email-link (magic link, which confirms the email by design).
   No passwords, Apple later.
5. **Who pays for public interests' runs?** **Recommend:** the house, with public runs counted
   against the global ceiling first, so a cost spike pauses user runs before curated ones.
6. **Runs on the host's quota after followers grow?** **Recommend:** yes, unchanged.
   A shared interest costs the host the same with 1 or 100 followers, because it runs once.

## Sources

- [S1] Supabase Edge Functions limits: https://supabase.com/docs/guides/functions/limits
  (wall clock 150 s free / 400 s paid, 2 s CPU, 150 s request idle timeout).
- [V1] Vercel Functions limits: https://vercel.com/docs/functions/limitations
  (Hobby 300 s max; Pro 800 s, 1800 s beta).
- [V2] Vercel cron usage: https://vercel.com/docs/cron-jobs/usage-and-pricing
  (Hobby once per day, ±59 min).
- [P1] Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
  (Haiku 5.5 $0.10/$0.50 per MTok ≤100K, batch 50% off; web search $10 per 1K; web fetch tokens only).
- [P2] Web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
  (`max_uses`, `pause_turn`, errors in a 200, Haiku 5.5 supported).
- Supabase Pro price and idle pausing: from memory, not fetched. Check supabase.com/pricing.

## Håkon's decisions (20 Nov 2026)

- Free limits: 1 daily + 3 weekly to start (numbers live in the `plans` table).
- Supabase Pro from day one.
- Sign-in: Google plus email link. Apple later.
- Public brief page (readable without sign-in, "Make your own brief" button) is in Phase 1; see docs/MARKETING.md. Signed-out visitors need read access to public interests' latest runs.
- Branches: `main` is the backup of the local version; hosted work lives on `ideas`, later `development` and `production`.
