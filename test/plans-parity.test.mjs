// The paid plan lives in two places: src/lib/plans.ts (what every screen shows)
// and the database's plans table (what allowance() and the triggers enforce).
// The two languages can't share code, so this test reads every migration into a
// fresh database and checks each plan's price and limits match plans.ts.

import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "../scripts/sql-test-db.mjs";
import { PLANS } from "../src/lib/plans.ts";

test("plans.ts and the plans table agree on every plan's price and limits", async () => {
  const pg = await freshDatabase();
  try {
    const { rows } = await pg.query(
      `select id, price_nok, price_usd_cents, max_interests, daily_interests,
              weekly_interests, on_demand_runs_per_day, max_public_interests
       from public.plans order by id`,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      Object.keys(PLANS).sort(),
      "the same plans",
    );
    for (const row of rows) {
      const plan = PLANS[row.id];
      assert.deepEqual(
        {
          priceNok: row.price_nok,
          priceUsdCents: row.price_usd_cents,
          topics: row.max_interests,
          dailyTopics: row.daily_interests,
          weeklyTopics: row.weekly_interests,
          runNowPerDay: row.on_demand_runs_per_day,
          publicTopics: row.max_public_interests,
        },
        {
          priceNok: plan.priceNok,
          priceUsdCents: plan.priceUsdCents,
          topics: plan.topics,
          dailyTopics: plan.dailyTopics,
          weeklyTopics: plan.weeklyTopics,
          runNowPerDay: plan.runNowPerDay,
          publicTopics: plan.publicTopics,
        },
        row.id,
      );
    }
  } finally {
    await pg.close();
  }
});
