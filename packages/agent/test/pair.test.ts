// Unit tests for pairing-token resolution (PER-102).
//
// `scout-agent pair` must reuse an existing token by default but mint a fresh
// one under --force/--reset. resolvePairingToken() is the pure decision the CLI
// wraps, so we test it directly — no filesystem, no process spawn.
//
// Run with: pnpm --filter @scout/agent test

import test from "node:test";
import assert from "node:assert/strict";
import { resolvePairingToken, type State } from "../src/state.js";

test("reuses an existing token by default", () => {
  const state: State = { pairing_token: "existing-token" };
  const { token, rotated } = resolvePairingToken(state);
  assert.equal(token, "existing-token");
  assert.equal(rotated, false);
});

test("force rotates to a fresh token, invalidating the old one", () => {
  const state: State = { pairing_token: "existing-token" };
  const { token, rotated } = resolvePairingToken(state, true);
  assert.notEqual(token, "existing-token");
  assert.equal(rotated, true);
  assert.ok(token.length > 0);
});

test("mints a token on first pairing (no existing token)", () => {
  const { token, rotated } = resolvePairingToken({});
  assert.ok(token.length > 0);
  assert.equal(rotated, true);
});

test("force on a fresh state still mints exactly one token", () => {
  const { token, rotated } = resolvePairingToken({}, true);
  assert.ok(token.length > 0);
  assert.equal(rotated, true);
});

test("successive forced rotations yield distinct tokens", () => {
  const first = resolvePairingToken({ pairing_token: "a" }, true).token;
  const second = resolvePairingToken({ pairing_token: first }, true).token;
  assert.notEqual(first, second);
});
