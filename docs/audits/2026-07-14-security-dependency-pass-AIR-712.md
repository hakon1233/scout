# Security & dependency hygiene audit - 2026-07-14 (AIR-712)

Recurring Security Engineer pass. Scope: dependency/CVE health, dependency
hygiene, secret handling, markdown/XSS surfaces, companion loopback boundaries,
Supabase edge-function boundaries, child-process seams, CI permissions, and
follow-up triage. No paid Apify scrape was run.

## Summary

No new actionable security fix was found in this pass.

- `pnpm audit` found zero known vulnerabilities across production and dev
  dependencies.
- Dependency drift remains routine patch/minor runtime and dev-tooling updates,
  plus non-security toolchain majors.
- The active pnpm override block in `pnpm-workspace.yaml` still resolves
  advisory-free transitive versions.
- Secret-pattern scans found no committed live credential. Hits were expected
  environment variable names, README/example placeholders, docs/tests, or local
  token plumbing.
- Markdown rendering remains explicitly sanitized on feed, chat, profile, and
  interest-doc surfaces.
- The companion, Supabase edge functions, RLS migrations, CI workflows, static
  file serving, and child-process seams remain consistent with prior hardening
  passes.

## Dependency Hygiene

### Security: 0 vulnerabilities

| Package set                     | Result                                            |
| ------------------------------- | ------------------------------------------------- |
| Production dependencies         | 0 info / 0 low / 0 moderate / 0 high / 0 critical |
| All dependencies, including dev | 0 info / 0 low / 0 moderate / 0 high / 0 critical |

`pnpm` still warns that `package.json#pnpm.overrides` is ignored by modern pnpm.
This is expected from prior passes: the active override block lives in
`pnpm-workspace.yaml`, while the legacy `package.json` mirror remains for older
pnpm compatibility.

Resolved transitive versions checked during this pass:

| Package       | Resolved version | Override intent |
| ------------- | ---------------- | --------------- |
| `postcss`     | 8.5.15           | `>=8.5.10`      |
| `@babel/core` | 7.29.7           | `^7.29.6`       |
| `js-yaml`     | 4.2.0            | `^4.2.0`        |
| `esbuild`     | 0.28.1           | `>=0.28.1`      |

### Outdated packages

Patch/minor updates available:

| Package                | Current |  Latest | Type          |
| ---------------------- | ------: | ------: | ------------- |
| `next`                 |  16.2.6 | 16.2.10 | runtime patch |
| `react`                |  19.2.6 |  19.2.7 | runtime patch |
| `react-dom`            |  19.2.6 |  19.2.7 | runtime patch |
| `eslint-config-next`   |  16.2.6 | 16.2.10 | dev patch     |
| `@tailwindcss/postcss` |   4.3.0 |   4.3.2 | dev patch     |
| `tailwindcss`          |   4.3.0 |   4.3.2 | dev patch     |
| `@types/react`         | 19.2.15 | 19.2.17 | dev patch     |
| `@playwright/test`     |  1.60.0 |  1.61.1 | dev minor     |
| `prettier`             |   3.8.3 |   3.9.5 | dev minor     |
| `tsx`                  |  4.22.3 |  4.23.1 | dev patch     |

Major updates available but not security-driven in this pass:

| Package       |  Current | Latest | Note                                                                                               |
| ------------- | -------: | -----: | -------------------------------------------------------------------------------------------------- |
| `@types/node` | 20.19.41 | 26.1.1 | Project/agent engines target Node >=20; keep aligned unless intentionally moving runtime baseline. |
| `eslint`      |   9.39.4 | 10.7.0 | Toolchain major; not a security finding.                                                           |
| `typescript`  |    5.9.3 |  7.0.2 | Compiler major; not a security finding.                                                            |

Recommendation: batch low-risk patch/minor updates separately with normal build
and e2e coverage. Do not mix toolchain majors into an unrelated security pass.

### Unused dependency candidates

No high-confidence runtime candidates. Runtime dependencies remain small:
`next`, `react`, `react-dom`, `react-markdown`, and `rehype-sanitize`.
`@scout/agent` still has zero runtime package dependencies.

## Security Surfaces Re-Checked

- **Companion HTTP surface:** still binds to `127.0.0.1`; `/v0/*` routes share a
  hostile-origin deny gate; CORS allows loopback, exact production origins,
  exact configured origins, and private `.ts.net` origins only.
- **Auth:** data-bearing and state-changing companion routes require bearer
  pairing-token auth. `/v0/config` remains same-origin only because it returns
  the local pairing token.
- **Input bounds:** JSON request bodies are capped; interests, chat messages,
  schedule values, retry/selected topic inputs, and destructive replace flows
  are validated or confirm-gated before mutation.
- **Static file serving:** request paths are decoded defensively; resolved file
  candidates must stay under the webroot; malformed percent-encoding falls
  through to the normal 404 path.
- **Supabase edge functions:** `companion-token` validates and atomically claims
  short-lived pairing codes before minting scoped JWTs. `exa-search` verifies
  Supabase auth, posts only to the fixed Exa API URL, clamps `numResults`,
  enforces the daily per-user cap through `bump_exa_usage`, and keeps raw
  service-role/RPC errors server-side.
- **RLS and SQL:** user-owned tables have `user_id = auth.uid()` RLS policies.
  The `bump_exa_usage` security-definer function pins `search_path = public` and
  grants execute only to `service_role`.
- **Markdown/XSS:** feed, chat, profile, and interest intent-doc markdown all
  use `react-markdown` with `rehype-sanitize`. The only
  `dangerouslySetInnerHTML` hit remains the deterministic theme bootstrap in
  `ThemeToggle`, not user/model content.
- **Secrets:** Supabase edge functions read service-role, JWT, and Exa secrets
  from environment variables only. `.env.example` contains empty placeholders.
- **SSRF/redirect/CORS:** Exa proxy posts to the fixed Exa API URL. Client
  fetches target the companion base, fixed same-origin paths, or static sample
  URLs. No user-controlled redirect sink was found in the reviewed code.
- **Child-process seams:** companion process launches use `spawn`/`execFile`
  style APIs, not shell-interpolated `exec` with user input. Research subprocess
  tools are limited to `WebSearch,WebFetch`; chat subprocesses allow no tools.
  The companion never reads or forwards the user's Anthropic OAuth token; the
  local CLI self-auths.
- **CI permissions:** workflows keep `GITHUB_TOKEN` least-privileged for their
  jobs, pin third-party actions to SHAs, and publish npm using only the
  `NODE_AUTH_TOKEN` secret.

## Existing Follow-Ups Not Re-Filed

- **AIR-457** - full `script-src 'self'` CSP work with per-build inline script
  hashing.
- **AIR-390** - constant-time pairing-token comparison in companion auth.
- **AIR-198** - shared `spawnClaude()` helper and missing chat per-session
  timeout; this is still visible in `chat.ts`, but it is already tracked.
- **AIR-177** - raw `String(err)` exposure class in error responses/persisted
  failure messages.

## Verification

- `pnpm audit --prod --json` -> 0 vulnerabilities.
- `pnpm audit --json` -> 0 vulnerabilities.
- `pnpm outdated --recursive --format json` -> patch/minor drift plus
  non-security toolchain majors listed above. The command exits 1 when outdated
  packages exist; the JSON payload was parsed successfully.
- `pnpm list postcss @babel/core js-yaml esbuild tsx --depth 20 --json` ->
  active override targets resolve to the advisory-free versions listed above.
- Focused credential-pattern scan over tracked source/docs/config -> no live
  credential; hits were placeholders, docs, tests, env var names, and local
  token plumbing.
- Source review: companion server/static routing, Supabase edge functions,
  migrations/RLS, child-process seams, markdown renderers, CI workflows, package
  manifests, and prior audit docs.

## Disposition

Audit complete. No new child fix issues were opened because no concrete
untracked vulnerability or security-driven dependency update was found.
