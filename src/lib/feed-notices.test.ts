import assert from "node:assert/strict";
import test from "node:test";

import { muteNoticeId } from "./feed-notices";

test("the mute offer has one id a week, so a dismissal lasts until next Monday", () => {
  const monday = muteNoticeId(new Date(2026, 10, 16, 8));
  assert.equal(monday, "mute_pushes:2026-11-16");
  assert.equal(muteNoticeId(new Date(2026, 10, 22, 23)), monday);
  assert.equal(
    muteNoticeId(new Date(2026, 10, 23, 0, 5)),
    "mute_pushes:2026-11-23",
  );
});
