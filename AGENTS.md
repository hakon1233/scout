<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Tests

`pnpm test` runs the hermetic `@scout/agent` suite (PER-118): unit + `/v0` API
contract tests for the loopback companion. It mocks the `claude` shell-out, so
it runs fully offline with zero Claude quota and no network. CI runs it on
every push/PR. Before touching `packages/agent/src/*` or `/v0/*` behavior, run
`pnpm test` — it guards the known regressions (PER-91/92/106/108/110/113).
Test files: `packages/agent/test/*.test.ts` (`node:test` + `tsx`).
