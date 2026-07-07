# Scout — Full Repo Audit (2026-07-07)

**Auditor:** CTO (Fable/Claude), analysis-only sweep for CAR-297.
**Audited at commit:** `b3cf4e5` (`feat(agent): surface corrupt-state recoveries on /healthz`), on `main`.
**Method:** 4-phase pass (Map → Audit → Prioritize → Deliver). Five parallel read-only
reviewers (security, companion architecture, frontend, testing/CI, perf/deps/docs); every
finding re-verified by the CTO against the working tree at the commit above. No code was
modified — the only write is this document.

> ⚠️ **Fast-moving repo caveat.** During this audit the tree advanced ~13 commits
> (`acf7d09` → `b3cf4e5`). Several candidate findings were **fixed mid-audit** by
> concurrent work (see [§5](#5-resolved-during-the-audit)). Line numbers below are exact
> as of `b3cf4e5` but may drift. Before starting any backlog issue spawned from this doc,
> re-confirm the cited code still matches — and check for in-flight `PER-*` work on the
> same area, since an active engineering stream is already grinding this backlog down.

---

## 1. Repo map

**What it is.** *Scout* — a personalised AI news platform. You set interests; an agent
fetches and synthesises a per-user brief. The distinguishing architectural bet: **no
server-side AI keys**. All model work happens on the user's own machine via their local
`claude` CLI.

**Stack.**
- **Frontend** (`src/`): Next.js **16.2.6** (App Router), React 19, Tailwind v4.
  `output: "export"` — a fully **static** site (no Next server runtime, no route handlers)
  deployed to **GitHub Pages** via `.github/workflows/deploy.yml`. `basePath` is derived
  from `GITHUB_REPOSITORY` at build time (`next.config.ts`).
- **Loopback companion** (`packages/agent/`, published to npm as `@scout/agent`, v0.3.0):
  a **zero-runtime-dependency** Node/TypeScript HTTP server that binds `127.0.0.1:47821`.
  The web app talks only to it; it **shells out to the user's local `claude` CLI**
  (`--print`, WebSearch/WebFetch tools) for research + synthesis, so the Anthropic OAuth
  token never leaves the machine. It also serves the web UI from its own loopback origin
  and can install itself as a macOS **launchd** service.
- **Supabase** (`supabase/`): Postgres + Auth + RLS migrations and two Deno **edge
  functions** (`companion-token`, `exa-search`). **These are orphaned** — nothing in
  `src/` imports `@supabase` or references either function (verified). They are vestigial
  from a pre-loopback architecture.

**Entry points / control flow.**
- Web: `src/app/layout.tsx` → `src/app/app/page.tsx` (the main brief view, 721 LOC) →
  `src/lib/companion.ts` (825 LOC, the loopback client: token bootstrap, poll, error map).
- Companion: `packages/agent/src/cli.ts` (`pair` / `run`) → `server.ts` (router) →
  `routes/*.ts` handlers → `runner.ts` (orchestrates per-interest `claude` sessions) /
  `chat.ts` (profile chat) / `scheduler.ts` (daily) / `weekly.ts` (digest). State persists
  as JSON under `~/.config/scout/` via `persistence.ts` (atomic temp+rename+fsync).

**Maturity.** Past prototype, approaching production for a single-user/founder-dogfood
deployment. Signals of care: hermetic offline test suite that gates the deploy, atomic +
fsync'd writes, corrupt-file preservation, single-flight run/chat guards, a documented
CORS/Origin/Host trust model, and a `check:tarball-dist` guard that fails the deploy if the
shipped tarball drifts from source. Weak spots: frontend test depth, observability, doc
freshness, and two ~950-LOC god files.

**Conventions to respect when fixing.** Heavy inline "why" comments citing ticket IDs
(`PER-*`); `[server]`/`[runner]`/`[chat]`/`[state]` log prefixes; dependency injection of
`spawnFn`/clock for testability; atomic writes for every persisted file; ship-integrity
guards in CI. Fixes should match this culture (add the "why", inject seams, keep it
offline-testable).

**Surprising / notable.**
- README front-matter says "Next.js 15"; the repo is on 16.2.6 (a deliberately breaking
  fork — see `AGENTS.md`).
- README + `.env.example` describe a "Haiku 4.5 ranking / Opus 4.7 synthesis" two-stage
  pipeline and a Supabase-keyed onboarding flow. **The code has neither** — one
  single-pass `claude` session per interest, no `--model` flag, no client Supabase.
- `@scout/agent` is published **publicly** to npm but declared `"license": "UNLICENSED"`.
- Only 236 files are git-tracked; all build output (`webroot/`, `e2e/.artifact/`, `out/`,
  `.next/`, `*.tgz`) is correctly gitignored.

---

## 2. Audit findings

Severity = concrete blast radius × likelihood. Each finding: what / where (`file:line` at
`b3cf4e5`) / why it matters / suggested fix + rough effort (S ≤ half-day, M ≈ 1–2 days,
L ≈ 3+ days).

### 2.1 Reliability & correctness

**F1 — HIGH — Chat turns have no hard timeout; a hung `claude` child wedges all chat.**
`packages/agent/src/chat.ts` `chatComplete` (~L384–464) waits only on `close`/`error`/abort
— there is **no** `setTimeout`-kill, unlike `research.ts:118` (4-min SIGTERM→SIGKILL). If a
chat `claude` child stalls and the user never presses Stop, `runChatTurn`'s promise never
settles, so the module-global `chatInFlight` guard never resets and every later turn (and
both confirm routes) 409s with "chat turn in progress". The stale-pending reclaim only
rescues a *restarted* process, not the live wedged one. One stuck child bricks the chat
surface until the companion is restarted — the same class PER-181 fixed for briefs.
*Fix:* give chat the same bounded timeout; best done via **F2**. Effort **S**.

**F2 — HIGH (maintainability) — Duplicated `claude` subprocess client; the copies have
already drifted.** `research.ts` (~L77–175) and `chat.ts` (~L384–464) are near-identical
(same spawn argv, `os.setPriority` niceness, dual `StringDecoder` accumulation, spawn-error
text, non-zero-exit mapping) — no shared helper exists (verified: no `claudeText`/
`runClaude` symbol). The drift already bit: the per-session timeout was added to research
only, which *is* **F1**. *Fix:* extract one `claudeText(prompt, {allowedTools, timeoutMs,
signal, niceness})` both call — fixes F1 for free. Effort **M**.

**F3 — MED — `state.json` read-modify-write is not serialized; concurrent writers can drop
fields.** Every subsystem does its own `loadState → {...state, field} → saveState`
(`state.ts:295–356`; writers in `runner.ts`, `scheduler.ts`, `chat.ts`, `weekly.ts`, routes).
`atomicWriteFile` (now fsync'd, `persistence.ts`) makes each write torn-safe, but there is
no lock across the load→save cycle. On the single event loop, two sequences that each
`await loadState` before either `saveState`s are last-writer-wins — e.g. a `PUT /v0/interests`
interleaving a scheduled run's completion can drop the just-persisted brief. Given this
app's documented data-loss sensitivity (wipe-guard, ephemeral incident), silent state loss
is the highest-stakes *data* failure mode. *Fix:* a single serialized state-writer
(in-process mutex/queue). Effort **M**.

**F4 — MED — On-disk state is cast, not validated (`as State`); only `interests` is
checked.** `state.ts:305–315`: `JSON.parse(raw) as State`, then only `migrateInterests`
runs. `last_brief`, `briefs`, `schedule`, `last_chat` are trusted verbatim. `state.json` is
explicitly a user-inspectable/editable file, so a malformed-but-parseable field flows
untyped into handlers and the UI, failing far from the cause. *Fix:* shape-validate/migrate
the other fields on load, mirroring `migrateInterests`. Effort **M**.

### 2.2 Architecture & code quality

**F5 — MED — `chat.ts` (948 LOC) has low cohesion — five concerns in one module:**
transcript persistence, a ~185-line prompt builder, the claude client, output parsing, two
confirm-flows, and module-global single-flight/abort state. Unrelated changes collide in
one 37 KB file. *Fix:* split into transcript store / prompt builder / claude client (shared
via F2) / change-applier / turn-orchestrator. Effort **L**.

**F6 — MED — `src/app/app/page.tsx` (721 LOC) is a god component.** 12 `useState`, 4 mount
effects (token bootstrap, ping-poll, latest-brief adoption, interest reconciliation), the
full generate/retry/runNow/runWeekly/cancel orchestration, coverage bucketing, stale-filter
derivation, and the layout shell — all in one file. It is the highest-churn file in the repo
(PER-146/154/157/191/219/222/241). The interdependent effects are where the next bug lands.
*Fix:* extract a `useCompanionSession()` hook (token + ready + brief/interest reconcile) and
move pure derivations into small modules. Effort **M**.

**F7 — LOW-MED — Dead code across `src/lib` (verified zero importers):** the entire
`run-history.ts` module; `storage.ts` `loadPrevBrief`/`savePrevBrief`/`clearPrevBrief`;
`companion.ts` `saveInterests` (carries load-bearing-looking PER-240 wipe-guard logic that
is wired to nothing); `interest-docs.ts` `interestEditorHref` + `fetchInterestDocMeta`;
`likes.ts` `removeLike`. Dead exports read as live API and invite drift. *Fix:* delete (or
annotate if forward-compat). Effort **S**.

**F8 — LOW-MED — Small frontend cleanups (bundle):** (a) `connect/page.tsx` reimplements
the POST-interests→poll-briefs state machine already in `companion.ts refreshBriefViaCompanion`
— two poll loops to keep in sync. (b) `hooks/useAbortableEffect.ts` exposes a `scope.signal`
no caller consumes (0 hits) — in-flight fetches are **not** aborted on unmount, only their
`setState` is skipped; the abort half is inert. (c) `companion.ts fetchLatestBrief`
(~L497) polls "since epoch" and re-parses *every* brief through the markdown parser on each
`/app` load, then reduces for the newest, though a `limit`/offset endpoint exists.
*Fix:* reuse the shared poller; thread `signal` into fetch helpers or drop it; fetch
newest-only. Effort **S–M**.

### 2.3 Frontend robustness

**F9 — MED — Unvalidated `as` casts on every companion/chat JSON response; one is a real
crash path.** All response bodies are `(await res.json()) as <Shape>` with no runtime
validation across `companion.ts` and `chat.ts`. Most helpers degrade safely, but
`pollBriefsRaw` returns `json.briefs` with **no** `?? []` fallback (`companion.ts:731`),
while sibling paths guard (`:710`). Its callers (`:491`, `:608`, `:796`) assume an array, so
a malformed/empty `{}` body yields a `TypeError` surfaced as a confusing generic error
instead of a clean "no briefs". *Fix:* add `?? []` in `pollBriefsRaw`; add a small shared
response-guard for the browser↔loopback trust boundary. Effort **S** (crash) / **M** (broad).

### 2.4 Security

*(Two flagship items — DNS-rebinding Host validation and constant-time token comparison —
were **fixed mid-audit**; see [§5](#5-resolved-during-the-audit). The posture below is
otherwise solid: loopback-only bind, traversal guards on `static.ts`/`docs.ts`, no shell
interpolation (args arrays + stdin, OAuth token never in argv/env), complete RLS, CSPRNG
256-bit token, no wildcard CORS, `0600`/`0700` file modes.)*

**F10 — MED — Orphaned parallel Supabase auth architecture holds powerful secrets and is
unused by the client.** `supabase/functions/companion-token/index.ts` is an
**unauthenticated** endpoint that, given a pairing code, mints a 12-hour authenticated
Supabase user-session JWT (signed with `SUPABASE_JWT_SECRET`) and carries
`SUPABASE_SERVICE_ROLE_KEY`. Nothing in `src/` references it (verified). Deploying an
unmaintained, no-one-watching function that mints sessions and holds the service-role key is
pure attack surface; the code-length regex (~60 bits) also undershoots the comment's 96-bit
claim, and there's no rate limit. **⚠️ Touches secrets — founder/GPT-5.5 item, do NOT route
remediation to a Fable/Claude agent.** *Fix:* pick one architecture — if the local companion
is canonical, delete `companion-token`/`exa-search` + their tables + dead `ANTHROPIC_API_KEY`;
else add rate-limiting and fix the entropy. Effort **M**.

**F11 — MED — `claude` is spawned with `--dangerously-skip-permissions`.** Both `research.ts`
(L93) and `chat.ts` pass it, so no permission prompt gates any tool. Research sessions get
`WebFetch`, and the prompt is built from user interest text — a fetched page can prompt-inject
the agent into attacker-chosen outbound fetches (exfiltrating the user's interest/intent
docs, probing other hosts). This is inherent to a WebFetch research agent, but the flag
removes the last backstop, and if the `--allowed-tools` allowlist ever regresses to empty/
omitted (defaulting to all), there is nothing behind it. *Fix:* explicit minimal permission
mode instead of the blanket skip; assert a non-empty allowlist; consider a WebFetch domain
allowlist / egress limit. Effort **M**.

**F12 — LOW — Error-response hygiene + token lifecycle (bundle).** (a) The 500 catch-all
returns `{ error: String(err) }` to the client (`server.ts:312`) — can disclose absolute
paths/internal state; the detail is now also logged (b3cf4e5), so the body can safely go
generic. (b) The single pairing token (256-bit CSPRNG, good) has **no TTL and no per-device
revocation** — the only revocation is a full rotation (`cli.ts pair --force`) that logs out
all clients; any XSS on the served UI yields a permanent companion credential.
*Fix:* generic 500 body; add token expiry/rotation + per-device tokens. Effort **S** (body)
/ **M** (tokens).

### 2.5 Performance

**F13 — MED — Chat transcript grows unbounded with an O(n) full rewrite per turn.**
`chat.ts appendChatTranscript` (~L172) reads the whole file, pushes/replaces, sorts, and
`JSON.stringify`s the entire array on every turn (writers at ~L780/853/941). There is **no
persistence cap** — `CHAT_CONTEXT_TURN_LIMIT = 20` only trims what's sent to the model
(`chat.ts:227`), not what's stored. Contrast briefs (`BRIEF_HISTORY_CAP = 30`, `state.ts`).
Cost per turn scales with total history (~O(n²) over a session's life). *Fix:* cap the
stored transcript on write, mirroring the brief cap. Effort **S**.

**F14 — LOW-MED — `state.json` bloat: `bases` duplicated across up to 30 briefs; full
re-read+rewrite per mutation/poll.** Each historical `Brief` carries a `bases[]` snapshot of
the full intent-doc for every covered interest (`runner.ts`), so the same docs are copied
into up to 30 entries; `loadState` re-reads+parses the whole file on the poll hot path (the
connect page polls every 4s during a run). Bounded by the 30-cap (~100s of KB), not urgent.
*Fix:* store `bases` by reference / drop from history entries; or cache parsed state
in-process with mtime invalidation. Effort **M**. *(Minor sibling: the 24 ms typewriter
interval re-parses react-markdown each tick in `useProfileWorkbench.ts:308` — reduced-motion
users exempt, replies short; stream plain text and run the pipeline once. Effort S.)*

### 2.6 Testing & CI

**F15 — MED — Frontend unit coverage is thin, and `safe-storage.test.ts` never executes.**
PER-271 added `companion.test.ts` (markdown parser) + `page.test.ts` (coverage buckets),
both now wired into CI via `test:web` — good. But `test:web` globs **explicit files**
(`package.json:14`) and omits `src/lib/safe-storage.test.ts`, so that test still never runs
(it could be red today). Core client logic remains untested: `likes.ts`, `chat.ts`,
`interest-docs.ts`, `useProfileWorkbench.ts`, and most of `companion.ts`'s
fetch/poll/error-map surface (the browser↔loopback trust boundary) — only E2E touches them.
*Fix:* glob `src/**/*.test.ts` so no test is silently dropped; backfill unit tests for the
client-logic core. Effort **M**.

**F16 — MED — `format:check` is never run in CI, and lint doesn't fail on warnings.**
`.prettierrc.json` is committed and `format:check` exists (`package.json:11`) but neither
`ci.yml` nor `deploy.yml` runs it, and there's no pre-commit hook — formatting drift lands
freely. `"lint": "eslint"` (`package.json:9`) has no `--max-warnings 0`, so the lint job is
green while warnings (unused vars, hook-deps, `no-explicit-any`) accumulate invisibly.
*Fix:* add `pnpm format:check` to both workflows; `eslint --max-warnings 0`. Effort **S**.

**F17 — MED — Sparse server observability.** The only `console.*` in the server is the (new)
500 catch-all (`server.ts:308`). Every handled 401/403/400/409/413 returns with **no** log
line; there is no per-request access log (route/status/latency); and fire-and-forget
synthesis/chat spawn failures (`claude` not on PATH, non-zero exit) are persisted for the
client to poll but not logged server-side. The most common prod failures — token-mismatch
storms, hostile-origin probes, "my run does nothing" — produce zero server signal.
*Fix:* one-line request log + log handled 4xx/5xx and spawn failures at the failure point
(keep the existing prefix convention). Effort **M**.

**F18 — MED — Untested imperative paths: launchd service + subprocess failure branches.**
`service.test.ts` covers only the two pure functions; the entire `installService`/
`uninstallService`/`serviceStatus` launchd sequencing (a top onboarding step and classic
support generator) is untested. `research.ts` subprocess error/exit≠0/empty-output/SIGKILL
paths and `stripBriefPreamble` are untested — exactly the paths a real user hits.
*Fix:* inject the `launchctl` runner and assert the command sequence; add stub-spawn cases
for the failure branches. Effort **M**.

**F19 — LOW — E2E flake vectors.** `e2e/playwright.config.ts` binds a **fixed** port 47821
with `reuseExistingServer: false` — any globally-installed `scout-agent` or leftover instance
fails the whole run; and the webServer command runs a full `pack:agent` (webroot export +
compile + npm pack) inside a 240 s startup timeout with `retries: 0`. *Fix:* randomize the
port (or `listen(0)`); pre-build the artifact in a separate CI step so the timeout covers
only boot. Effort **S–M**. *(Also: a PR never runs `check:tarball-dist`/`pack:agent` — drift
is caught only post-merge in `deploy.yml`. Consider adding it to `ci.yml`. S.)*

### 2.7 Dependencies & docs

**F20 — HIGH (legal/supply-chain) — `@scout/agent` is published PUBLIC to npm as
`UNLICENSED` with no LICENSE file.** `package.json:29` (`"license": "UNLICENSED"`) +
`:30–32` (`publishConfig.access: public`) + `publish-agent.yml:30` (`publish --access
public`). "UNLICENSED" declares all-rights-reserved/proprietary, yet the package (including
the bundled web UI in `webroot`) is pushed to the public registry — publicly downloadable
with zero usage grant. One of the two intents is wrong. *Fix:* decide licensing — add an
SPDX id + `LICENSE` if open, or make the package private if not. Effort **S**. *(Minor:
root `package.json` has no `license` field; CI runs Node 22 while `engines`/`@types/node`
target 20 — mild drift.)*

**F21 — MED — README/`.env.example` are stale and self-contradictory.** (a) README:10 says
"Next.js 15" (actual 16.2.6). (b) README:13 / `.env.example:10` describe a "Haiku 4.5
ranking, Opus 4.7 synthesis" two-stage pipeline the code doesn't implement (single-pass, no
`--model`). (c) README's local-dev flow says "fill in Supabase keys" and `.env.example`
lists `ANTHROPIC_API_KEY`/`EXA_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` as required, while the
client imports no Supabase and reads none of them — and README elsewhere says none are
needed. (d) README:10 links a "PER-2 architecture doc, v2" that doesn't exist in-repo.
New contributors are told to provision keys the app never uses. *(The `.env`/README secret
contradiction is already filed as AIR-329/393/394 — still open.)* *Fix:* rewrite the stack/
env/onboarding sections around the loopback architecture. Effort **M**.

**F22 — LOW-MED — Audit-doc clutter with no index.** 37 files in `docs/audits/` + 9 in
`docs/`, no `INDEX`/`README`, including a hyphen-variant **duplicate**
(`2026-06-25-architecture-tech-debt-pass.md` vs `…-techdebt-pass.md`) and ~20 near-identical
per-ticket `…-pass-{AIR,CAR,FLI}-*.md` files. `AGENTS.md` cites stale `PER-*` ticket refs.
Unnavigable accumulation. *Fix:* add `docs/audits/README.md` index; delete the duplicate;
collapse per-ticket passes into dated summaries; refresh `AGENTS.md` refs. Effort **M**.

---

## 3. Prioritise (impact × effort)

**Do first — cheap, high-impact (S/M):**
1. **F1+F2** — extract shared `claude` client + add chat timeout. One fix kills a
   chat-wedging reliability bug *and* the drift hazard. **Highest ROI.**
2. **F20** — resolve the public-`UNLICENSED` contradiction. Legal exposure, S effort.
3. **F9** — `pollBriefsRaw ?? []` crash guard. S effort, removes a live TypeError path.
4. **F16** — enforce `format:check` + `--max-warnings 0` in CI. S effort, stops silent rot.
5. **F13** — cap chat transcript growth. S effort, prevents unbounded on-disk O(n²).

**Do next — structural integrity (M):**
6. **F3** — serialize `state.json` writes (data-loss prevention).
7. **F4** — validate all state fields on load.
8. **F15** — glob `src/**/*.test.ts` + backfill client-logic unit tests.
9. **F17** — server request/failure logging (prod-debuggability).
10. **F21** — fix README/`.env` so onboarding matches reality.

**Founder / GPT-5.5 (secrets — do NOT route to a Fable/Claude agent):**
11. **F10** — decommission-or-harden the orphaned Supabase `companion-token`/`exa-search`
    functions (service-role key + JWT minting).

**Then — quality & hardening (M/L):**
12. **F11** (permission mode), **F5** (split chat.ts), **F6** (extract useCompanionSession),
    **F18** (service/subprocess tests).

**Backlog cleanups (S, low-signal, batch when convenient):**
13. **F7** (dead code), **F8** (frontend cleanups), **F12** (error/token hygiene),
    **F14** (state bloat), **F19** (E2E flake), **F22** (doc housekeeping).

---

## 4. Themes

- **The two ~950-LOC god files** (`chat.ts`, `app/app/page.tsx`) concentrate most of the
  maintainability risk and churn. `server.ts` was the third — already decomposed (§5).
- **Single-process global mutable state** (`chatInFlight`, `runInFlight`, unsynchronized
  `state.json` R-M-W) is the root of F1 and F3; it's a deliberate single-user design, but
  it's the failure mode to watch as the app grows.
- **The frontend is the weakest tier for tests/observability** — the companion suite is
  genuinely strong (hermetic, behavioral, deploy-gating); the browser side is catching up
  (PER-271) but the trust-boundary client (`companion.ts`) is still thinly covered.
- **Documentation and the Supabase remnants describe an architecture that no longer
  exists** — a recurring source of contributor confusion (F10, F21, and the audit clutter).

---

## 5. Resolved during the audit

Verified fixed at `b3cf4e5` — **do not file these:**

| Candidate finding | Resolved by |
|---|---|
| **DNS-rebinding: no Host-header check let a public page steal the pairing token via `/v0/config`** (was the flagship HIGH) | `ff2ef71` — `isHostAllowed(req.headers.host)` gate (`server.ts:149`) + `isSameOriginCaller` now requires host match |
| **Pairing-token comparison not constant-time** | `ff2ef71` — `timingSafeTokenEqual` (`http-util.ts:95`) |
| **`server.ts` monolithic 1105-LOC router; route table didn't drive dispatch; per-route auth boilerplate ×12** | `e1fb46c` — decomposed into `server.ts` (329) + `http-util.ts` + `routes/*`; `V0_ROUTES` now drives dispatch with a uniform per-route auth seam |
| **Zero frontend unit tests (the single test was orphaned)** | `c98a413` (PER-271) — `companion.test.ts` + `page.test.ts`, wired into CI via `test:web` (**partial** — `safe-storage.test.ts` still excluded → F15) |
| **500 unhandled errors left no server-side trace** | `b3cf4e5` — 500 catch-all now `console.error`s (**partial** — body still leaks `String(err)` → F12) |

---

## 6. Backlog issues filed

Per CAR-297, one backlog issue was filed per actionable finding above (F1–F22, with small
items bundled), assigned to the CEO at **status = backlog** (queued, not started), each
referencing this doc + its `file:line`. **F10 is flagged as a founder/GPT-5.5 item** because
it touches secrets. No fix work was started by this audit.
