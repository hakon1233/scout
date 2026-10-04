import test from "node:test";
import assert from "node:assert/strict";
import { assessRunFailure } from "./run-failure";

test("assessRunFailure: a stale scheduled failure is suppressed once a newer on-demand run succeeds", () => {
  // 07:00 scheduled fire failed, then 09:00 "Run now" succeeded. schedule.last_run_status
  // is only written by scheduled runs (runner.ts), so it stays "failed" while last_brief
  // is a fresh 09:00 ready brief. The failure is stale — no false banner.
  const result = assessRunFailure({
    lastStatus: "ready",
    lastError: null,
    lastAt: "2026-07-12T09:00:00.000Z",
    scheduleStatus: "failed",
    scheduleNote: "Claude usage/session limit reached — try again later",
    scheduleAt: "2026-07-12T07:00:00.000Z",
    lastSuccessAt: "2026-07-12T09:00:00.000Z",
    now: Date.parse("2026-07-12T09:05:00.000Z"),
  });
  assert.equal(result, null);
});

test("assessRunFailure: a scheduled failure with no newer success still flags failed", () => {
  // 07:00 scheduled fire failed; the last success is older (yesterday). The failure is
  // current — the banner must still fire.
  const result = assessRunFailure({
    lastStatus: "failed",
    lastError: null,
    lastAt: "2026-07-12T07:00:00.000Z",
    scheduleStatus: "failed",
    scheduleNote: "the research sessions timed out",
    scheduleAt: "2026-07-12T07:00:00.000Z",
    lastSuccessAt: "2026-07-11T07:00:00.000Z",
    now: Date.parse("2026-07-12T07:05:00.000Z"),
  });
  assert.equal(result?.kind, "failed");
  assert.equal(result?.reason, "the research sessions timed out");
  assert.equal(result?.at, "2026-07-12T07:00:00.000Z");
});

test("assessRunFailure: a failed on-demand slot with an older success still flags failed", () => {
  // The on-demand last_brief itself errored and is the most recent run of any kind, so
  // any surviving success is legitimately older — the failure is real.
  const result = assessRunFailure({
    lastStatus: "failed",
    lastError: "all research sessions failed — couldn't launch the Claude CLI",
    lastAt: "2026-07-12T10:00:00.000Z",
    scheduleStatus: "success",
    scheduleNote: null,
    scheduleAt: "2026-07-12T07:00:00.000Z",
    lastSuccessAt: "2026-07-12T07:00:00.000Z",
    now: Date.parse("2026-07-12T10:05:00.000Z"),
  });
  assert.equal(result?.kind, "failed");
  assert.equal(result?.reason, "couldn't launch the Claude CLI");
});
