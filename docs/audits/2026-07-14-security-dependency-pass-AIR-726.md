# Security & dependency hygiene audit - 2026-07-14 (AIR-726)

Recurring Quality Loop pass for AIR-726. Scope: dependency/CVE health, safe
version bumps, input validation, SSRF/redirect/CORS mistakes, secret handling,
unsafe defaults, and whether concrete untracked fix issues should be opened.
The paid Apify scrape was not run.

## Summary

No new actionable security vulnerability was found in this pass.

- `pnpm audit --json` reported zero known vulnerabilities across 545 resolved
  packages.
- `pnpm outdated --json` reported routine patch/minor drift for runtime and dev
  packages; no security-driven update was indicated by the audit result.
- A focused secret-pattern scan found no committed live credential. Hits were
  expected test tokens, docs, placeholders, and comments describing token
  handling.
- Companion HTTP routing, CORS/origin gates, pairing-token auth, JSON body
  bounds, static file containment, markdown rendering, local state persistence,
  and child-process seams remain consistent with recent hardening passes.
- AIR-712 already recorded the same-day broader security posture and existing
  follow-ups, so this pass does not duplicate those issues.

## Prioritized Findings

### 1. [Info] Patch/minor dependency drift is present but not security-driven

`pnpm outdated --json` currently reports these low-risk runtime patches:

| Package | Current | Latest |
| --- | ---: | ---: |
| `next` | 16.2.6 | 16.2.10 |
| `react` | 19.2.6 | 19.2.7 |
| `react-dom` | 19.2.6 | 19.2.7 |

Dev-tool patches/minors are also available for `eslint-config-next`,
`@tailwindcss/postcss`, `tailwindcss`, `@types/react`, `@playwright/test`,
`prettier`, and `tsx`. Major updates are available for `@types/node`,
`eslint`, and `typescript`, but those are toolchain-baseline decisions rather
than hygiene fixes.

Recommendation: batch the patch/minor updates in a dependency-maintenance issue
only if the team wants a freshness sweep. This audit did not open a security
fix issue because `pnpm audit` found no advisory pressure.

### 2. [Info] `--dangerously-skip-permissions` remains a defense-in-depth tracking item

The local companion spawns `claude` with a fixed argv array and passes user
content over stdin, so there is no shell interpolation path. Research sessions
allow only `WebSearch,WebFetch`; chat sessions pass an empty allowed-tools
list. That keeps the current exploitability low.

The flag is still a sensitive seam because future CLI behavior or tool-list
drift could widen the local subprocess authority. AIR-712 already lists the
existing shared `spawnClaude()` follow-up, so this pass did not re-file it.

## Areas Checked

- **Known-vulnerable dependencies:** no advisories from `pnpm audit --json`.
- **Secret handling:** no live credentials in tracked source/docs/config; the
  companion never reads or forwards the user's Anthropic OAuth token and relies
  on the local CLI to self-auth.
- **CORS and local agent boundary:** `packages/agent/src/http-util.ts` keeps an
  explicit origin allowlist, denies hostile browser origins for `/v0/*`, gates
  `/v0/config` to same-origin callers, and validates Host headers.
- **Input validation and unsafe defaults:** request bodies are capped at 16 KiB;
  interests, chat messages, schedule values, retry/selected topics, and
  destructive replace flows are bounded or confirm-gated before mutation.
- **SSRF and redirects:** reviewed fetch/spawn/static routes. Client fetches are
  to the companion base or fixed app paths; the static file server resolves
  decoded candidates under the webroot before reading.
- **Markdown/XSS:** chat enables `rehype-sanitize`; other markdown surfaces use
  `react-markdown` without raw HTML parsing. The only `dangerouslySetInnerHTML`
  hit is the deterministic theme bootstrap, not user/model content.
- **Persistence:** state and docs live under `~/.config/scout` with owner-only
  modes and atomic writes; corrupt state is preserved before fresh fallback.

## Existing Follow-Ups Not Re-Filed

- AIR-457 - full `script-src 'self'` CSP work with per-build inline script
  hashing.
- AIR-390 - constant-time pairing-token comparison in companion auth.
- AIR-198 - shared `spawnClaude()` helper and related child-process hardening.
- AIR-177 - broader raw-error exposure cleanup class.

## Verification

- `pnpm audit --json` -> 0 vulnerabilities.
- `pnpm outdated --json` -> outdated package JSON listed above; command exited
  1 because outdated packages exist, not because parsing failed.
- Focused source review: `packages/agent/src/server.ts`,
  `packages/agent/src/http-util.ts`, `packages/agent/src/routes/*.ts`,
  `packages/agent/src/static.ts`, `packages/agent/src/research.ts`,
  `packages/agent/src/chat.ts`, `packages/agent/src/state.ts`,
  `packages/agent/src/persistence.ts`, and markdown renderer components.
- Secret-pattern scan over tracked source/docs/config -> no live credential.
- `pnpm exec depcheck --json` was attempted but not used: pnpm tried to install
  the transient tool and aborted because module purge confirmation is disabled
  without a TTY. No dependency changes were made.

## Disposition

Audit complete. No child fix issues were opened because no concrete untracked
vulnerability or security-driven dependency update was found.
