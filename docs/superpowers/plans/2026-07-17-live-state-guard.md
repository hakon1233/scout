# Live State Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect any founder-visible Scout state change during a live-origin verification window and attribute the evidence to the current Paperclip run.

**Architecture:** A standalone Node command snapshots SHA-256 manifests for `state.json`, `interests/**`, and `chat/**` under `~/.config/scout`. `snapshot` stores a secret-free baseline in the OS temporary directory keyed by `PAPERCLIP_RUN_ID`; `check` recomputes the manifest, stays silent when unchanged, and prints added/modified/deleted paths with hashes before exiting non-zero when state changed.

**Tech Stack:** Node.js standard library (`node:crypto`, `node:fs`, `node:os`, `node:path`), `node:test`, pnpm scripts.

---

### Task 1: Specify the command through behavior tests

**Files:**

- Create: `test/live-state-guard.test.mjs`
- Test: `test/live-state-guard.test.mjs`

- [ ] **Step 1: Write the failing tests**

Use temporary state and snapshot directories, invoke the command as a child process, and assert:

```js
assert.equal(snapshot.status, 0);
assert.equal(check.status, 0);
assert.equal(check.stdout, "");
```

Then mutate `state.json`, add an interest, and remove the transcript before asserting:

```js
assert.equal(check.status, 1);
assert.match(check.stderr, /run test-run-change/);
assert.match(check.stderr, /M state\.json/);
assert.match(check.stderr, /A interests\/new\.md/);
assert.match(check.stderr, /D chat\/transcript\.json/);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test test/live-state-guard.test.mjs`

Expected: FAIL because `scripts/live-state-guard.mjs` does not exist.

### Task 2: Implement the state snapshot/check command

**Files:**

- Create: `scripts/live-state-guard.mjs`
- Test: `test/live-state-guard.test.mjs`

- [ ] **Step 1: Implement the minimal command**

The command interface is:

```text
pnpm --silent live-state-guard snapshot
pnpm --silent live-state-guard check
```

It requires `PAPERCLIP_RUN_ID`, defaults `SCOUT_STATE_DIR` to `~/.config/scout`, and allows `SCOUT_LIVE_GUARD_DIR` only to isolate automated tests. Store only relative paths, SHA-256 digests, and the run identifier; never copy or print founder data.

- [ ] **Step 2: Run the focused test to verify GREEN**

Run: `node --test test/live-state-guard.test.mjs`

Expected: 2 tests pass with no warnings.

### Task 3: Put the guard at the moment of temptation

**Files:**

- Modify: `package.json`
- Modify: `AGENTS.md`
- Test: `test/live-state-guard.test.mjs`

- [ ] **Step 1: Add the package command**

Add:

```json
"live-state-guard": "node scripts/live-state-guard.mjs"
```

- [ ] **Step 2: Replace the interim manual runbook step**

Document the exact sequence:

```text
pnpm --silent live-state-guard snapshot
# approved live-origin interaction
pnpm --silent live-state-guard check
```

State that `check` is silent with exit 0 on no delta and emits hash-only, run-attributed evidence with exit 1 on any delta.

- [ ] **Step 3: Verify the real package command against hermetic state**

Run the snapshot/check pair with temporary `SCOUT_STATE_DIR` and `SCOUT_LIVE_GUARD_DIR`; verify a clean pass, then change a fixture file and verify a non-zero result naming the run and changed path. Do not contact port 47821 or read/write `~/.config/scout`.

- [ ] **Step 4: Run scoped quality checks**

Run:

```text
node --test test/live-state-guard.test.mjs
pnpm exec prettier --check scripts/live-state-guard.mjs test/live-state-guard.test.mjs package.json AGENTS.md docs/superpowers/plans/2026-07-17-live-state-guard.md
```

Expected: all tests pass and formatting is clean.

- [ ] **Step 5: Commit and push**

Commit the implementation with the required Paperclip co-author trailer, push directly to `origin/main`, and verify the remote ref equals local `HEAD`.
