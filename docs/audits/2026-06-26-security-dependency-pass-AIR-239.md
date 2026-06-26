# Security & dependency hygiene audit — 2026-06-26 (AIR-239)

Recurring Quality-Loop pass (Security Engineer). Scope: known-vulnerable deps and
safe bumps, input validation, SSRF/redirect/CORS, secret handling, unsafe defaults.
Audited at `origin/main` (`421bf42`, post-CAR-63). Builds on the 2026-06-25 pass
(`docs/audits/2026-06-25-security-dependency-pass.md`). Apify scrape **not** run —
HARD GUARDRAIL honored; no flow here calls it.

## Summary

The product remains in good security shape. The runtime attack surface is small and
has had several prior hardening passes. This pass focused on the delta since
2026-06-25 (refactors/perf only — no new input/CORS/fetch surface) and on dependency
currency via `pnpm audit`. **Outcome: `pnpm audit` is now fully green (0
vulnerabilities, prod and dev).** The only action was clearing two dev-tooling
advisories with safe in-range overrides — applied directly in this pass.

## Findings

### 1. [Resolved before this pass] `@babel/core` arbitrary file read (GHSA-4x5r-pxfx-6jf8)
`@babel/core <=7.29.0` (CVE-2026-49356, low, CVSS 3.2) reaches the **prod** tree
transitively via `next@16.2.6 > styled-jsx`. Already mitigated on `main` by the
existing `pnpm.overrides["@babel/core"]: "^7.29.6"` (resolves to 7.29.7). No prod
vulnerabilities remained at audit time. Not exploitable here regardless: the
advisory requires attacker-controlled *input source code*; Babel only compiles the
app's own trusted source. Noted for the record.

### 2. [Fixed this pass — dev tooling] `js-yaml` quadratic-DoS in merge keys (GHSA-h67p-54hq-rp68)
`js-yaml <=4.1.1` (CVE-2026-53550, moderate, CVSS 5.3) via `@eslint/eslintrc` —
lint-time only, never shipped. Not exploitable here (js-yaml parses only the
project's own ESLint config, never untrusted YAML). **Fix:** added
`pnpm.overrides["js-yaml"]: "^4.2.0"` → resolves to 4.2.0 (same major, patched).
Pinned to `^4.2.0` deliberately — a bare `>=4.2.0` pulls the breaking `js-yaml@5`
major, which is not a safe bump.

### 3. [Fixed this pass — dev tooling] `esbuild` dev-server file read on Windows (GHSA-g7r4-m6w7-qqqr)
`esbuild >=0.27.3 <0.28.1` (low, CVSS 2.5) via `tsx` (the `@scout/agent` test
runner) — dev/test-time only, never shipped. Not exploitable here: the advisory is
specific to running esbuild's *dev server on Windows*; this project uses tsx's
transform API (not `esbuild serve`) and develops on macOS/Linux. **Fix:** added
`pnpm.overrides["esbuild"]: ">=0.28.1"` → resolves to 0.28.1 (patch). Lockfile churn
is mechanical (per-platform optional binaries bump 0.28.0→0.28.1).

**Verification:** `pnpm audit` 0/0 across all severities; `pnpm test` 133/133 green
(tsx exercises esbuild 0.28.1); `pnpm lint` 0 errors (eslint exercises js-yaml 4.2.0).
Change is two override lines + lockfile regen — small and trivially reversible.

## Areas checked and found clean (no action)

- **Delta since 2026-06-25.** 23 commits, all refactors/perf (FLI/AIR/CAR). No new
  `child_process`/`shell:true`/`eval`, no new `dangerouslySetInnerHTML`, no new
  user-controlled `fetch` target, no CORS-allowlist change.
- **Command injection.** No `child_process`/`eval`/`exec*` in `src` or
  `packages/agent/src`; all `.exec(` hits are `RegExp.prototype.exec`.
- **XSS.** Single `dangerouslySetInnerHTML` (`ThemeBootstrap` in
  `src/components/ThemeToggle.tsx`) is a static template interpolating only the
  compile-time `STORAGE_KEY` constant — no user input.
- **SSRF / fetch targets.** All client fetches target fixed/relative URLs
  (`window.location.origin`, loopback `baseFor(port)`) — no user-controlled hosts.
- **CORS.** `packages/agent/src/server.ts` allowlist (loopback + `scout.notiva.no`
  + tailnet + opt-in `SCOUT_ALLOWED_ORIGINS`) intact; ACAO echoed only on allowlist
  hit. Unchanged since the prior pass.
- **Secrets.** No hardcoded secrets in `src`/`packages`/`scripts`; `.env*`
  gitignored; companion never forwards the user's Claude token. Unchanged.

## Recommendation

No fix-issues filed — the two concrete items were safe dependency overrides applied
directly (matching the prior pass's "trivial fix applied directly" disposition).
`pnpm audit` is fully green. Next pass: re-run `pnpm audit` for newly-disclosed CVEs
and re-check `next`/`react` currency.
