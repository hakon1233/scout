# Security & dependency hygiene audit — 2026-06-26 (AIR-251)

Recurring Quality-Loop pass (Security Engineer). Scope: known-vulnerable deps and
safe bumps, input validation, SSRF/redirect/CORS, secret handling, unsafe defaults.
Audited at `gh/main` HEAD `1371368`. Delta pass on top of the same-day AIR-239 pass
(`docs/audits/2026-06-26-security-dependency-pass-AIR-239.md`), which left
`pnpm audit` fully green. Apify scrape **not** run — HARD GUARDRAIL honored; no flow
in scope calls it.

## Summary

No new security findings. `pnpm audit` is still **fully green** (0 vulnerabilities,
prod and dev). The only application-code change since the AIR-239 pass is itself a
**security hardening**, not a regression. No fix-issues filed.

## Dependency hygiene

- `pnpm audit --prod` → **No known vulnerabilities found.**
- `pnpm audit` (all severities, incl. dev) → **No known vulnerabilities found.**
- The overrides from prior passes remain in `package.json`
  (`@babel/core ^7.29.6`, `js-yaml ^4.2.0`, `esbuild >=0.28.1`, `postcss`),
  each pinned within-major to avoid a breaking bump. Runtime deps unchanged and
  current: `next@16.2.6`, `react@19.2.6`, `react-dom@19.2.6`,
  `react-markdown@10.1.0`, `rehype-sanitize@6.0.0`. `packages/agent` has zero
  runtime deps.

## Application-code delta since AIR-239 (`421bf42..1371368`)

Exactly **one** code commit touched audited paths (`src`, `packages/agent/src`,
`scripts`): `7d8a1f9 fix(agent): require pending delete proposal`.

- **`packages/agent/src/chat.ts` — `confirmDeleteTurn`** now requires a server-side
  `state.last_chat.pending_delete` whose `interestId` matches the request before it
  will apply a delete; otherwise it returns `not_found`. This is a **defensive
  improvement**: the delete route is now strictly a stored-proposal consumer (mirrors
  `confirmRewriteTurn`), so a stale client card or a direct route call can no longer
  delete an interest by id without first going through the server-issued confirmation
  proposal. Reviewed — correct and reduces attack surface. No action.

The remaining newer commits on `main` (`FLI-239/253/266/278`, `dc1f636`, `1371368`)
are perf/architecture **doc-only** additions under `docs/` — no code, no new surface.

## Areas re-checked, still clean (no action)

- **Command injection.** All `child_process` use is `spawn`/`execFile` with argv
  arrays (no `shell: true`, no string concatenation) and a test-injected override;
  it spawns the trusted `claude` CLI, never a user-controlled program. No
  `eval`/`new Function`. Unchanged by the delta.
- **XSS.** Single `dangerouslySetInnerHTML` (`ThemeBootstrap` in
  `src/components/ThemeToggle.tsx`) interpolates only the compile-time `STORAGE_KEY`
  constant. Markdown rendered via `react-markdown` + `rehype-sanitize`. No user
  input reaches raw HTML.
- **SSRF / fetch targets.** Client fetches (`src/lib/companion.ts`) target the
  loopback companion base from `requireBase()`; query params are numeric
  (`limit`/`offset`) or `encodeURIComponent`-escaped (`since`). No user-controlled
  host. No redirect-following on attacker input.
- **CORS.** `packages/agent/src/server.ts` allowlist (loopback + `scout.notiva.no`
  + tailnet + opt-in `SCOUT_ALLOWED_ORIGINS`) intact; `Access-Control-Allow-Origin`
  echoed only on allowlist hit. Unchanged.
- **Secrets / unsafe defaults.** No hardcoded secrets in `src`/`packages`/`scripts`
  (grep for key/secret/password/token literals: none). `.env*` gitignored; only
  `.env.example` placeholders committed. Companion never forwards the user's Claude
  token. Unchanged.

## Verification

- `pnpm audit --prod` → 0 vulnerabilities.
- `pnpm audit` → 0 vulnerabilities.
- No code changed this pass (audit-only); build/lint/test posture from AIR-239
  (133/133 tests, 0 lint errors, audit green) carries forward unchanged.

## Recommendation

No fix-issues filed — nothing concrete moves the needle this cycle. The dependency
tree is clean and the only code delta was a hardening. **Disposition: done.**

Next pass: re-run `pnpm audit` for newly-disclosed CVEs; re-check `next`/`react`
currency; re-audit any new input/CORS/`fetch`/`child_process` surface that lands.
