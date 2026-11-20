// The chat's guide states the plans' limits in words. This keeps them in step
// with the plans the screens show.
import test from "node:test";
import assert from "node:assert/strict";
import { SCOUT_GUIDE } from "@scout/core";
import { PLANS } from "./plans";

test("the chat guide names the plans' current limits", () => {
  const f = PLANS.free;
  const p = PLANS.plus;
  assert.ok(
    SCOUT_GUIDE.includes(
      `${f.topics} topics (${f.dailyTopics} daily, ${f.weeklyTopics} weekly), ${f.runNowPerDay} Run now a day, ${f.publicTopics} public topics`,
    ),
  );
  assert.ok(SCOUT_GUIDE.includes(`at most ${f.publicTopics} of yours`));
  assert.ok(SCOUT_GUIDE.includes(p.price.replace(" a month", "")));
  assert.ok(
    SCOUT_GUIDE.includes(
      `${p.topics} topics, all daily, ${p.runNowPerDay} Run now a day`,
    ),
  );
});
