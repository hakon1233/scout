# Security & dependency hygiene audit — 2026-06-26 (CAR-109)

Recurring Quality-Loop parent closeout for CAR-109. Scope: known-vulnerable
dependencies and safe bumps, input validation, SSRF/redirect/CORS mistakes, secret
handling, and unsafe defaults. This document consolidates the completed security
passes already landed on `main` and records the CTO disposition after the child work
completed.

## Summary

The product is in good security shape for this cycle. `pnpm audit --prod` is clean
in the current checkout, and the prior full pass found no remaining application-code
findings worth filing. The only concrete dependency hygiene items discovered during
the 2026-06-26 passes were already fixed directly with small `pnpm.overrides` entries:

- `@babel/core` patched to `^7.29.6` for GHSA-4x5r-pxfx-6jf8.
- `js-yaml` patched to `^4.2.0` for GHSA-h67p-54hq-rp68.
- `esbuild` patched to `>=0.28.1` for GHSA-g7r4-m6w7-qqqr.

These are dependency-only changes, already reflected in `package.json` and the
lockfile. No additional implementation issues are being opened from CAR-109 because
there are no remaining concrete, unfixed findings; filing duplicates would violate
the audit guardrail to avoid re-tracking already handled items.

## Findings

### 1. [Resolved] Build-time Babel arbitrary file read advisory

`@babel/core <=7.29.0` was present transitively through
`next@16.2.6 > styled-jsx`. The project already overrides it to `^7.29.6`, resolving
to a patched 7.x release. Impact was low even before the bump because Babel compiles
trusted project source, not attacker-provided source code.

### 2. [Resolved] Dev-tooling YAML parsing DoS advisory

`js-yaml <=4.1.1` reached the tree through ESLint tooling. The project already
overrides it to `^4.2.0`. This is dev-time only and parses trusted project config.

### 3. [Resolved] Dev-tooling esbuild advisory

`esbuild >=0.27.3 <0.28.1` reached the tree through `tsx`. The project already
overrides it to `>=0.28.1`. The advisory concerns esbuild's dev server on Windows;
this project uses `tsx` for test-time transforms, not an exposed esbuild server.

## Areas Rechecked

- `pnpm audit --prod` reports no known vulnerabilities.
- Runtime dependency surface remains small: `next`, `react`, `react-dom`,
  `react-markdown`, and `rehype-sanitize`.
- `packages/agent` still has no runtime dependencies.
- Prior application-code findings remain clean: no user-controlled fetch targets,
  no shell execution of user input, static-only `dangerouslySetInnerHTML`, explicit
  companion CORS allowlist, no committed secrets, and RLS-backed client credentials.

## Recommendation

Close CAR-109 as done. The audit produced findings, the concrete findings are already
fixed, and there is no remaining small reversible fix-issue to delegate. Next recurring
security pass should re-run `pnpm audit` and only open child issues for newly disclosed
CVEs or newly introduced application attack surface.
