# Security & dependency hygiene audit — 2026-06-26

Recurring Quality-Loop pass (FLI-235, Security Engineer). Scope: known-vulnerable
deps + safe bumps, input validation, SSRF/redirect/CORS, secret handling, unsafe
defaults. Audited at `origin/main` (HEAD `7b58c34`).

This is a **delta pass** on top of the previous comprehensive audit
(`docs/audits/2026-06-25-security-dependency-pass.md`, AIR-182). That pass found the
product in good shape; nothing material has changed in the application code since
(only doc/copy commits). So this pass focused on its explicit follow-up: re-run
`pnpm audit` against the lockfile for newly-disclosed CVEs and re-check dep currency.

## Summary

`pnpm audit` surfaced exactly **one** new advisory — a low-severity, build-time-only
transitive dependency. Fixed in this pass via a minimal, reversible pnpm override.
No application-code findings; the prior pass's clean bill (RLS, CORS/PNA posture,
secret handling, no SSRF/command-injection, sanitized markdown) still holds.

## Findings (prioritized)

### 1. [Low — FIXED this pass] `@babel/core <=7.29.0` arbitrary file read via sourceMappingURL
`pnpm audit` reported GHSA-4x5r-pxfx-6jf8 against `@babel/core@7.29.0`, pulled
transitively: `next@16.2.6 > styled-jsx@5.1.6 > @babel/core`. The flaw lets a
crafted `//# sourceMappingURL=` comment read an arbitrary file **at compile time**.
Real-world impact here is minimal — scout only ever compiles its own trusted source
(static `output: "export"` build, no untrusted code path through babel) — hence Low.
Still a free, safe bump.

**Fix:** added `"@babel/core": "^7.29.6"` to the existing `pnpm.overrides` block in
`package.json`. Resolves `@babel/core` to `7.29.7` (patched, stays on the 7.x line —
deliberately **not** `>=7.29.6`, which would jump to the brand-new `8.0.1` major and
is out of scope for a hygiene bump). `pnpm audit --prod` now reports
**no known vulnerabilities**.

**Verification (all green):** `pnpm install` clean · `pnpm audit --prod` clean ·
`pnpm lint` 0 errors (31 pre-existing `<img>` warnings, unrelated) · `pnpm build`
succeeds (14/14 static routes) · `pnpm test` 128/128 pass.

## Areas re-checked, still clean (no action)

- **Runtime deps current.** `next@16.2.6`, `react@19.2.6`, `react-dom@19.2.6`,
  `react-markdown@10.1.0`, `rehype-sanitize@6.0.0`. `packages/agent` has zero runtime
  deps. No other advisories; no safe-bump backlog.
- **App code unchanged since AIR-182.** Only doc/copy commits landed on `origin/main`
  since the last pass, so the prior findings (input validation, SSRF/redirect/CORS,
  secret handling, unsafe defaults, RLS, markdown XSS, command injection) carry
  forward unchanged. See `2026-06-25-security-dependency-pass.md` for the detail.
- **Apify scrape not run** — guardrail honored; no flow calls it.
- **No secrets committed.** `.env*` gitignored (only `.env.example` placeholders);
  client bundle holds only the RLS-protected public anon key + URL.

## Recommendation

No fix-issues filed — the single concrete item is a one-line, reversible override
applied directly to `main` (consistent with the AIR-182 precedent). Nothing else
moves the needle this cycle.

Next pass: re-run `pnpm audit`; watch `@babel/core` for a clean `8.x` migration once
`styled-jsx`/`next` adopt it; re-check `next`/`react` currency for new CVEs.
