# What one Scout run costs

23 Nov 2026. Model: `claude-haiku-5-5` on the Anthropic API. Rate used: 1 USD = 9.7511 NOK.

## Sources first (24 Nov 2026)

A run's web budget now comes from its intent doc (core `runLimits`, used by the hosted run and the team runner):

| Intent doc                           | Searches | Fetches | Cost per run (estimate) | Daily topic / month | Weekly topic / month |
| ------------------------------------ | -------- | ------- | ----------------------- | ------------------- | -------------------- |
| Has a "Sources, check first" section | 1        | 4       | **~$0.015** (0.15 kr)   | ~$0.45              | ~$0.065              |
| Has none                             | 2        | 2       | **~$0.024** (0.23 kr)   | ~$0.72              | ~$0.10               |

These are estimates: one search fee ($0.01) per search plus about $0.005 of tokens, from the token model below. Fetches carry no fee. All 25 catalog topics have the section, so the team catalog would cost about **$3.15 a month** on the API (210 runs), down from $7.30. A user with 1 daily + 4 weekly topics written without sources: about $1.13 a month (was $1.64).

**Measured on Haiku 5.5, 24 Nov 2026**, four catalog topics, old limits (3 / 2) against new (1 / 4), one run each, same prompt:

| Topic                       | Stories old → new | Cost old → new      | Input tokens old → new |
| --------------------------- | ----------------- | ------------------- | ---------------------- |
| Home Assistant breaking     | 3 → 4             | $0.026 → $0.017     | 59K → 64K              |
| Bambu Lab firmware          | 3 → 1             | $0.027 → $0.005     | 60K → 58K              |
| Trondheim council decisions | 1 (undated) → 0   | $0.042 → $0.015     | 104K (long rate) → 58K |
| LLM releases (daily)        | 0 → 2             | $0.003 → $0.005     | 59K → 82K              |
| **Total**                   | **7 → 7**         | **$0.098 → $0.043** |                        |

Average cost fell from $0.024 to $0.011 a run (-57%). Story counts moved both ways; one run per side is too few to call quality equal or worse. Old runs often hit the fetch cap and searched instead; one crossed the 100K line. Fetches the API refused at `max_uses` still count in `web_fetch_requests`.

The sections below are the 23 Nov analysis, made with the old 3 / 2 limits.

## Summary

One hosted run on 23 Nov was a lean run: at most 3 web searches and 2 page fetches (pages cut to 3,000 tokens). Measured, not guessed: the typical figure is a real Haiku 5.5 run from 20 Nov 2026.

|                                             | Low        | Typical    | High                |
| ------------------------------------------- | ---------- | ---------- | ------------------- |
| Searches / fetches                          | 2 / 1      | 3 / 2      | 3 / 2, crosses 100K |
| Input tokens (all kinds, summed over steps) | ~35K       | 74K        | ~103K               |
| Output tokens (thinking included)           | ~1.5K      | 1.7K       | ~3K                 |
| **Cost per run, USD**                       | **$0.023** | **$0.035** | **$0.059**          |
| **Cost per run, NOK**                       | **0.22**   | **0.34**   | **0.57**            |

| Per month (30 runs daily, 4.3 weekly)                   | Low             | Typical             | High            |
| ------------------------------------------------------- | --------------- | ------------------- | --------------- |
| One daily topic                                         | $0.68 / 6.7 kr  | **$1.04 / 10.2 kr** | $1.76 / 17.2 kr |
| One weekly topic                                        | $0.10 / 1.0 kr  | **$0.15 / 1.5 kr**  | $0.25 / 2.5 kr  |
| User with 5 weekly topics                               | $0.49 / 4.8 kr  | **$0.75 / 7.3 kr**  | $1.26 / 12.3 kr |
| User with 1 daily + 4 weekly (Free allows this)         | $1.08 / 10.5 kr | **$1.64 / 16.0 kr** | $2.77 / 27.0 kr |
| User with 2 daily + 3 weekly (Plus)                     | $1.66 / 16.2 kr | **$2.53 / 24.7 kr** | $4.28 / 41.7 kr |
| Team catalog, 25 topics (4 daily, 21 weekly = 210 runs) | $4.80           | **$7.30 / 71 kr**   | $12.35          |

- **Biggest cost driver: the search fee.** $0.01 per search is $0.030 of the typical $0.035 (86%). Tokens are the rest: cache writes 10%, output 2.5%, cache reads 1.4%.
- **Second driver: the 100K line.** Haiku 5.5 charges 5x on every token of a request whose prompt passes 100,000 tokens. That is what made the old non-lean run $0.088.
- **Team catalog costs $0 in API money.** Team topics never run on the API. They run on Håkon's Mac with the local `claude` CLI, on his subscription. The figure above is what the same runs would cost on the API.
- **Logging today:** tokens, searches and cost are saved per hosted run. Page fetches, subscription runs, chat, picks and the publish check are not (see Logging).

## Method

1. Read how each path makes a run (below).
2. Take the usage numbers already recorded in the repo's research notes (three real runs and a four-topic test, 20 Nov).
3. Check the formula against those runs: it reproduces the typical run to the cent.
4. Check prices on Anthropic's pages today.
5. Build low, typical and high runs from the code's limits. Multiply by run counts.

No API call, `claude` run or database query was made for this note.

## How runs are made (from the code)

| Path                                                           | Model                                                 | Tools and limits                                                                                                                                                                                                                                                                                                                                      | Who pays                                     |
| -------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Hosted cron run (`packages/research/src/research-interest.ts`) | `claude-haiku-5-5` (`HAIKU_MODEL`)                    | `web_search_20250305` `max_uses` 1 with sources, else 2; `web_fetch_20250910` `max_uses` 4 with sources, else 2 (`runLimits`, since 24 Nov; 3 / 2 before); `max_content_tokens` 3,000. Plan `searches_per_run` (5) is a ceiling only. `max_tokens` 16,000. Effort: API default (medium). Up to 3 `pause_turn` continuations. Per-run spend cap $0.25. | Us, per use                                  |
| Team runner (`packages/agent/src/team-runner.ts`)              | The CLI's default, unless `SCOUT_CLAUDE_MODEL` is set | CLI `WebSearch,WebFetch`, the same `runLimits` budget in the prompt, `--max-turns` searches + fetches + 2                                                                                                                                                                                                                                             | Håkon's Claude plan                          |
| Local companion (`claude-runner.ts`)                           | Same as above                                         | CLI `WebSearch,WebFetch`, no budget (the reader pays)                                                                                                                                                                                                                                                                                                 | The reader's own Claude plan                 |
| Chat (`hosted/src/chat.ts`), picks, publish check              | `claude-haiku-5-5`, no tools                          | Picks and publish at effort low                                                                                                                                                                                                                                                                                                                       | Us, about $0.0005, $0.001 and $0.0002 a call |

Cache: the research prompt carries `cache_control: ephemeral` (5-minute cache). The API also caches growing context automatically, so a run shows about 10 uncached tokens and everything else as cache writes and reads.

## Prices (checked 23 Nov 2026)

Source: <https://platform.claude.com/docs/en/about-claude/pricing>, fetched 23 Nov 2026. `packages/research/src/pricing.ts` matches it exactly.

| Claude Haiku 5.5, per million tokens | Up to 100K prompt | Over 100K prompt |
| ------------------------------------ | ----------------- | ---------------- |
| Input                                | $0.10             | $0.50            |
| 5-minute cache write (1.25x)         | $0.125            | $0.625           |
| 1-hour cache write                   | $0.20             | $1.00            |
| Cache read (0.1x)                    | $0.01             | $0.05            |
| Output (thinking included)           | $0.50             | $2.50            |

- **Web search:** $10 per 1,000 searches ($0.01 each); a failed search is not billed. Results count as input tokens. Source: the same page and <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>.
- **Web fetch:** no fee, only the tokens of the page. Pricing page example: a 10 kB page is about 2,500 tokens.
- **Tool-use system prompt:** 286 tokens for Haiku 5.5 (pricing page).
- **100K rule:** "A request's prompt length counts all of its input tokens, including cache reads and cache writes. Each request is priced on its own." A run with server tools is one request whose `usage` sums every step, so `pricing.ts` tests the sum. This may over-charge slightly if real billing tests each step. It is not confirmed (no Admin key to check).
- **Tokenizer:** Claude 4.7 and later models produce about 30% more tokens than older ones for the same text. Haiku 5.5 is later, so 4 characters per token may undercount; 3 to 3.5 is safer.
- **Exchange rate:** 9.7511 NOK per USD, open.er-api.com, updated 23 Nov 2026 00:02 UTC. Cross-check: ECB EUR/NOK 10.7180 on 20 Nov 2026.

## Token model of one run

Counted from the repo:

- **Prompt without an intent doc:** 11,267 characters (built with `buildResearchPrompt`, 3 searches). About 2,800 tokens at 4 characters per token, 3,700 at 3. The shared search-skills text is most of it.
- **Intent docs** (`docs/public-interests/intent-docs/`, 18 files): smallest 2,956 characters (`atb-route-changes.md`), median about 4,140, largest 6,852 (`surf-jaeren.md`). Plus the wrapper, the whole prompt is 14.2K, 15.4K and 18.1K characters: about 3.6K, 3.9K and 4.5K tokens (4.7K, 5.1K, 6.0K at 3 characters per token).
- **Start of a run:** prompt (~4K) + tool system prompt (286) + tool definitions (~0.3K): about 4.5K to 5K tokens.
- **A search:** about 20K characters, 5 to 6K tokens, measured on 20 Nov. Results are added to the context in full.
- **A fetched page:** 2.5K tokens for an average 10 kB page; capped at 3,000 by `max_content_tokens`. (Older notes said 6K; that was the cap before the lean run.)
- **Output:** the brief is at most about 1,100 words (about 1.5K tokens), plus thinking. Measured 1.7K to 3.2K in total.

**How the multi-turn loop is billed.** With server tools the API runs search, read, search again inside one request. Each step re-sends the whole context so far. The final response's `usage` is the sum of all steps:

- The first copy of each new block is a cache write (1.25x input).
- Every later step re-reads it from cache (0.1x input).
- So cache writes end up about the size of the final context (the measured typical run: 26.6K), and cache reads are the sum of the earlier contexts (47.7K).
- This grows faster than the number of calls: step n re-reads everything before it. Six tool calls usually cross 100K summed; three searches and two fetches usually do not.
- The 100K line then re-prices every token of the request at 5x.

**The three runs**

|                    | Low                | Typical (measured) | High                     |
| ------------------ | ------------------ | ------------------ | ------------------------ |
| Searches / fetches | 2 / 1              | 3 / 2              | 3 / 2, 6 steps, long doc |
| Cache write        | ~15K               | 26,630             | ~28K                     |
| Cache read         | ~20K               | 47,685             | ~75K                     |
| Uncached input     | ~10                | 8                  | ~10                      |
| Summed prompt      | ~35K (normal rate) | 74K (normal rate)  | ~103K (**long rate**)    |
| Output             | ~1.5K              | 1,743              | ~3K                      |
| Search fees        | $0.020             | $0.030             | $0.030                   |
| Tokens             | $0.003             | $0.005             | $0.029                   |
| **Total**          | **$0.023**         | **$0.035**         | **$0.059**               |

Check on the typical run: 26,630 x $0.125/M = $0.0033, 47,685 x $0.01/M = $0.0005, 1,743 x $0.50/M = $0.0009, 3 x $0.01 = $0.030. Sum $0.0347, as the app's own `responseCostUsd` gives.

Where each row comes from:

- Typical: one real run (Raspberry Pi, weekly, 20 Nov 2026, `plan/research/run-cost.md` section 2).
- Low: the lean test runs in the same file (section 7): four topics, 2 searches and 0 to 1 fetches each, $0.023 to $0.025, average $0.024.
- High: not measured. Built from the caps (3 searches x 5.5K + 2 fetches x 3K + 5K start = 27.5K final context) with extra steps, a long doc and 3K output. I priced it at the long rate. If six steps stay under 100K it would be about $0.04.
- A continuation (`pause_turn`) adds one more request. The $0.25 cap stops a run that grows past it.
- For scale, the old non-lean run (5 searches, 6,000-token pages) was $0.088 and the average of five real database runs was $0.060.

## Scenarios

Runs per month: daily 30, weekly 4.3. All hosted runs, one run per topic per period.

**Per topic**

|        | Runs | Low            | Typical         | High            |
| ------ | ---- | -------------- | --------------- | --------------- |
| Daily  | 30   | $0.68 / 6.7 kr | $1.04 / 10.2 kr | $1.76 / 17.2 kr |
| Weekly | 4.3  | $0.10 / 1.0 kr | $0.15 / 1.5 kr  | $0.25 / 2.5 kr  |

**A user with 5 topics** (Free: 1 daily + 3 weekly with at most 5 topics; Plus: 6 daily + 3 weekly with at most 30)

| Mix                | Runs | Low             | Typical         | High            |
| ------------------ | ---- | --------------- | --------------- | --------------- |
| 5 weekly           | 21.5 | $0.49 / 4.8 kr  | $0.75 / 7.3 kr  | $1.26 / 12.3 kr |
| 1 daily + 4 weekly | 47.2 | $1.08 / 10.5 kr | $1.64 / 16.0 kr | $2.77 / 27.0 kr |
| 2 daily + 3 weekly | 72.9 | $1.66 / 16.2 kr | $2.53 / 24.7 kr | $4.28 / 41.7 kr |

Not counted: run-now runs (3 a day on both plans), chat turns (about $0.0005), picks and the publish check. All are cents a month. A public topic followed by many readers runs once for all of them, so a follower adds about $0.

**Team catalog.** `supabase/seeds/team-topics.sql` holds 25 public topics: 4 daily (LLM releases, npm/PyPI attacks, AtB route changes, northern lights) and 21 weekly. All are seeded paused, and `team:run` is off unless `SCOUT_TEAM_RUNNER=on` and `settings.team_runner_on`. Three more starter topics (Trondheim events, Nordic power prices, r/LocalLLaMA) are weekly and also skip the cron.

- Runs a month at full use: 4 x 30 + 21 x 4.3 = 210.
- Price on the API, if it ever ran there: $4.80 low, **$7.30 typical (71 kr)**, $12.35 high.
- Real cost today: $0, on Håkon's subscription. Public briefs for readers are meant to run on the API key (`plan/research/team-topics.md`), so $7.30 a month is the number to plan for if the catalog moves there.

**Subscription runs (a reader's own Claude plan, or Håkon's).** We pay nothing. How many runs fit a Pro plan cannot be worked out: Anthropic's help page (<https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work>, 23 Nov 2026) says Pro has a session limit that resets every five hours and weekly limits, but gives no numbers, and the Pro plan page I tried returned 404. What is known: a CLI run is 5 to 15 turns (code comment in `claude-runner.ts`) on the CLI's default model, so larger than the 35K to 103K-token API run. The only honest way to get a number is to log a few real runs against the Settings > Usage meter.

## Logging: what exists and the gap

**Logged today (hosted API runs)** in `public.runs` (migration `20261121234000_run_tokens.sql`, written by the Worker through `finish_run`):

- `cost_usd`
- `searches`
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`

These are sums over the run's Claude calls, including a failed run and retried attempts. Spend limits (`spend_per_day_usd`) read `cost_usd`. Older runs and team runs have null tokens.

**Gaps**

1. **Page fetches** (`server_tool_use.web_fetch_requests`): collected in `ResearchUsage.webFetches`, never saved.
2. **Subscription runs** (team runner, companion): `claude-runner.ts` uses `--output-format text`, so usage is thrown away. Nothing is recorded, for a cost that is only notional anyway.
3. **Chat, picks, publish check**: `cost_usd` only, no tokens.
4. **Per-step detail**: the API gives totals only, so the 100K line cannot be seen in the data.
5. **Console vs database**: the console showed about 20% more than the database on 20 Nov, from agent test calls outside the Worker. Not a counting bug.

**Proposed change** (run system, belongs to scout chief; described, not built). One migration plus a few lines in `research-interest.ts`, `finish_run` and the Worker store:

| Field                                                                          | From                                                                                                                                                    | Where                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `web_fetches`                                                                  | `usage.server_tool_use.web_fetch_requests` summed                                                                                                       | new `runs` column; one more `finish_run` argument                       |
| `requests` (calls incl. `pause_turn` continuations)                            | count in the loop                                                                                                                                       | new `runs` column                                                       |
| `max_prompt_tokens` (largest single request: input + cache read + cache write) | per response                                                                                                                                            | new `runs` column. Shows whether a run crossed 100K                     |
| `long_rate`                                                                    | `responseCostUsd` sets it when the summed prompt is over 100K                                                                                           | new `runs` boolean, or derive from `max_prompt_tokens`                  |
| `model`                                                                        | `RESEARCH_MODEL`                                                                                                                                        | `runs.model` already exists in the schema; save the model actually used |
| `stop_reason`                                                                  | last response                                                                                                                                           | new `runs` column (failure analysis)                                    |
| Chat, picks, publish: `input_tokens`, `output_tokens`, `cache_*`               | `response.usage`                                                                                                                                        | same four columns on `chat_turns`, `pick_runs`, publish checks          |
| CLI runs: tokens, turns, notional cost                                         | switch `--output-format` to `json` and read `usage`, `num_turns` and cost from the result (I have not run it; check the field names on a real stub run) | same `runs` columns, with `source = 'subscription'`                     |

One query then answers every cost question: `select date_trunc('month', created_at), sum(cost_usd), avg(cost_usd), sum(searches), sum(web_fetches), count(*) filter (where long_rate) from runs group by 1`.

## Sources

- Anthropic pricing: <https://platform.claude.com/docs/en/about-claude/pricing> (23 Nov 2026).
- Web search tool: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool> (23 Nov 2026).
- Claude usage limits: <https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work> (23 Nov 2026).
- USD/NOK: <https://open.er-api.com/v6/latest/USD> (23 Nov 2026); ECB reference rate for 20 Nov 2026.
- Measured runs: `plan/research/run-cost.md` in the main Scout checkout (20 Nov 2026).
- Code: `packages/research/src/pricing.ts`, `research-interest.ts`, `claude-client.ts`; `packages/agent/src/claude-runner.ts`; `packages/worker/src/supabase.ts`; `supabase/migrations/20261121234000_run_tokens.sql`; `supabase/seeds/team-topics.sql`.
