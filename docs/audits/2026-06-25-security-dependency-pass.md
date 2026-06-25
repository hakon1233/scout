# Security & dependency hygiene audit — 2026-06-25

Recurring Quality-Loop pass (AIR-182, Security Engineer). Scope: known-vulnerable
deps, input validation, SSRF/redirect/CORS, secret handling, unsafe defaults.
Audited at `origin/main` (post-FLI-198). Apify scrape **not** run — guardrail honored;
no flow here calls it.

## Summary

The product is in good security shape. The attack surface is small and has had
several prior hardening passes (PER-135/136/137/107/240/163). RLS is comprehensive,
the loopback companion server has a well-reasoned CORS/PNA posture, secrets are not
forwarded or committed, and the dependency tree is minimal and current. One concrete
low-severity information-disclosure bug was found and **fixed in this pass**.

## Findings (prioritized)

### 1. [Low — FIXED this pass] `exa-search` leaked internal DB error to the client
`supabase/functions/exa-search/index.ts` returned `rateErr.message` verbatim in the
500 body (`{ error: "rate_check_failed", detail: rateErr.message }`). A Postgres/
PostgREST error can carry internals (table/column names, SQL fragments) — needless
information disclosure. **Fix:** log the raw message server-side via `console.error`
and return a generic `{ error: "rate_check_failed" }`. Commit `af97270` on `main`.
No behavior change to the success/429 paths; isolated to a Deno edge function outside
the TS build/lint/test graph (`tsconfig` excludes `supabase/`).

### 2. [Info — accepted, not filed] `companion-token` has no per-IP rate limit
The pairing-code exchange (`supabase/functions/companion-token/index.ts`) is not
throttled. Brute force is infeasible regardless: codes are single-use, expire in 10m,
and the claim is atomic; even the regex floor of 12 base32 chars is ~60 bits of
entropy (production codes are 16 chars / 96 bits). Acceptable as-is; noting for the
record, not worth a fix-issue.

## Areas checked and found clean (no action)

- **Dependencies / CVEs.** Root runtime deps: `next@16.2.6`, `react@19.2.6`,
  `react-dom@19.2.6`, `react-markdown@^10.1.0`. `packages/agent` has **zero** runtime
  deps. All current; no known-vulnerable versions to bump. No safe-bump backlog.
- **XSS / markdown rendering.** `output: "export"` static site. `react-markdown` is
  used without `rehype-raw`/`allowDangerousHtml`, so raw HTML is escaped and the
  default `urlTransform` strips `javascript:`/`data:` hrefs. `ChatMarkdown` adds
  `rehype-sanitize` as belt-and-suspenders. The only `dangerouslySetInnerHTML`
  (`ThemeBootstrap`) is a static constant string — no user input.
- **Command injection.** `child_process.spawn` (research/chat/runner) is always called
  with an argv array and **no** `shell: true`; user text reaches `claude` as data, not
  shell. No `eval`/`exec`.
- **SSRF / redirects.** No user-controlled fetch targets. `exa-search` posts to a fixed
  `https://api.exa.ai/search`; `numResults` clamped 1–10, `query` trimmed/required.
- **CORS.** Companion server (`packages/agent/src/server.ts`) uses an explicit
  allowlist (loopback, `scout.notiva.no`, `*.<tailnet>.ts.net`, opt-in
  `SCOUT_ALLOWED_ORIGINS` matched exactly), echoes ACAO only on allowlist hit, denies
  the whole `/v0/*` surface on a non-allowlisted Origin, and gates `/v0/config`
  (token disclosure) to same-origin. Edge functions are CLI-called, not browser-facing.
- **RLS.** All user-owned tables (`interests`, `briefs`, `articles`,
  `companion_pairings`, `companion_devices`, `usage_exa_daily`) have RLS enabled with
  `user_id = auth.uid()` policies; writes that must bypass RLS go through service-role
  edge functions only. The `bump_exa_usage` `SECURITY DEFINER` function correctly sets
  `search_path = public`, is revoked from `public`, and granted only to `service_role`.
- **Secret handling.** Companion never reads/forwards the user's `sk-ant-oat01-…` token
  (`claude` self-auths locally). `.env*` gitignored (only `.env.example`, placeholders).
  No service-role key or JWT in the client bundle; static site holds only the public
  anon key + URL (RLS-protected). No hardcoded secrets in `src`/`packages`/`scripts`.
- **Body limits.** Companion enforces `MAX_BODY_BYTES` (16 KiB), interest count/length
  caps, and a destructive-replace "wipe guard" (PER-240).

## Recommendation

No fix-issues filed — the single concrete item was a one-line fix applied directly.
Next pass: re-run `pnpm audit` against the lockfile if network is available, and
re-check dep currency (esp. `next`/`react`) for newly-disclosed CVEs.
