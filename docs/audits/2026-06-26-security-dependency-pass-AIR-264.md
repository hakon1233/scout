# Security & dependency hygiene audit — 2026-06-26 (AIR-264)

Recurring Quality-Loop pass (Security Engineer). Scope: known-vulnerable deps and
safe bumps, input validation, SSRF/redirect/CORS, secret handling, unsafe defaults.
Audited at `gh/main` HEAD `29c41f3`. Builds on the same-day AIR-251 pass
(`docs/audits/2026-06-26-security-dependency-pass-AIR-251.md`) and the AIR-239 pass
that left `pnpm audit` fully green. Apify scrape **not** run — HARD GUARDRAIL
honored; no flow in scope calls it.

## Summary

No new security findings; **no fix-issues filed.** `pnpm audit` is still **fully
green** (0 vulnerabilities, prod and dev). There is **no application-code delta**
since the AIR-251 pass — the only commit since that pass's audited HEAD (`1371368`)
is `29c41f3`, the AIR-251 findings doc itself (docs-only). Rather than rubber-stamp
a third clean delta, this pass did a **fresh first-principles re-review** of the
companion's actual security boundaries (auth, CORS, path traversal, malformed-input
handling, secrets, SSRF, command injection) and confirms each is sound.

## Dependency hygiene

- `pnpm audit --prod` → **No known vulnerabilities found.**
- `pnpm audit` (all severities, incl. dev) → **No known vulnerabilities found.**
- Overrides from prior passes remain pinned within-major in `package.json`
  (`@babel/core ^7.29.6`, `js-yaml ^4.2.0`, `esbuild >=0.28.1`, `postcss >=8.5.10`).
  Runtime deps unchanged and current: `next@16.2.6`, `react@19.2.6`,
  `react-dom@19.2.6`, `react-markdown@10.1.0`, `rehype-sanitize@6.0.0`.
  `packages/agent` has zero runtime deps.

## Code delta since AIR-251 (`1371368..HEAD`)

`git diff --stat 1371368..HEAD -- src packages scripts next.config.ts package.json`
→ **empty.** The single intervening commit (`29c41f3`) only adds the AIR-251 audit
markdown. No new input/CORS/`fetch`/`child_process`/secret surface to review.

## First-principles re-review (boundaries independently re-verified clean)

- **Auth gate** (`server.ts` `authed`/`bearer`). Every `/v0/*` route requires a
  `Bearer` token matched against `state.pairing_token`. The comparison is a plain
  `!==` (not constant-time), but this is **not actionable**: the server binds
  loopback-only (127.0.0.1), and the token guards only the _browser-origin_
  boundary — any local process can already read `~/.config/scout/state.json`
  directly, so a loopback timing side-channel grants no privilege a local attacker
  lacks. Recorded so future passes don't re-discover it.
- **CORS** (`CORS_ALLOWED_ORIGINS`). Allowlist is loopback + `scout.notiva.no` +
  `hakon1233.github.io` + tailnet `*.*.ts.net` + opt-in exact-match
  `SCOUT_ALLOWED_ORIGINS` (regex-escaped, anchored — no wildcard). `corsHeaders`
  echoes ACAO only on allowlist hit; `isOriginDenied` 403s the whole `/v0/*`
  surface for any non-allowlisted browser Origin. `/v0/config` (hands out the
  pairing token) is stricter still — same-origin loopback only. Sound.
- **Path traversal** (`static.ts`). Every candidate is `path.resolve`d and rejected
  unless `filePath === root || filePath.startsWith(root + path.sep)`, so
  `..`/encoded-`..` escapes are contained. Verified across `resolveStatic`,
  `trailingSlashRedirect`, and `resolveAppShellFallback`.
- **Malformed input.** `decodeURIComponent` on a bad sequence (e.g. `%`, `%zz`)
  throws `URIError`, but the request handler's top-level `try/catch`
  (`server.ts:1082`) maps any throw to a 500 JSON — no process crash / unhandled
  rejection. Body parsing is bounded (`MAX_BODY_BYTES` 16 KiB, `MAX_INTEREST_LEN`
  200, `MAX_CHAT_MESSAGE_LEN` 4000) so oversized payloads can't exhaust memory or
  be forwarded into the priced Claude prompt.
- **SSRF / fetch targets.** All client fetches (`src/lib/companion.ts`, `chat.ts`,
  `interest-docs.ts`) target `requireBase()` loopback or `window.location.origin`;
  params are numeric (`limit`/`offset`) or `encodeURIComponent`-escaped (`since`).
  No user-controlled host, no attacker-controlled redirect following.
- **Command injection.** `child_process.spawn` is used only with an argv array (no
  `shell: true`, no string concat) to launch the trusted `claude` CLI
  (`SCOUT_CLAUDE_BIN`); no `eval`/`new Function`. All other `.exec(` hits are
  `RegExp.prototype.exec`.
- **Secrets / unsafe defaults.** Literal-secret grep over `src`/`packages`/
  `scripts` → none. `.env.example` holds only empty placeholders with correct
  guidance (anon key RLS-protected & client-safe; `ANTHROPIC_API_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` / `EXA_API_KEY` edge-function-only). `.env*`
  gitignored. `next.config.ts` is a plain static-export config — no unsafe
  headers/rewrites. Companion never forwards the user's Claude token.

## Verification

- `pnpm audit --prod` → 0 vulnerabilities.
- `pnpm audit` → 0 vulnerabilities.
- Audit-only pass (one markdown doc added); build/lint/test posture from AIR-239/251
  (133/133 tests, 0 lint errors, audit green) carries forward unchanged. New doc
  passes `prettier --check`.

## Recommendation

No fix-issues filed — nothing concrete moves the needle this cycle. Dependency tree
is clean and there was no code delta. **Disposition: done.**

Next pass: re-run `pnpm audit` for newly-disclosed CVEs; re-check `next`/`react`
currency; re-audit any new input/CORS/`fetch`/`child_process`/secret surface that
lands. If the companion ever moves off a loopback-only bind, revisit the
non-constant-time token comparison noted above.
