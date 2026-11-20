import test from "node:test";
import assert from "node:assert/strict";
import { assertNoFakeInProduction } from "../../next.config";
import { createFakeHostedData, fakeHostedOn } from "./hosted-fake";

test("the fake hosted backend is off in production, even with its flag set", () => {
  assert.equal(
    fakeHostedOn({
      NODE_ENV: "production",
      NEXT_PUBLIC_SCOUT_FAKE_HOSTED: "1",
    }),
    false,
  );
  assert.equal(fakeHostedOn({ NODE_ENV: "development" }), false);
  assert.equal(
    fakeHostedOn({
      NODE_ENV: "development",
      NEXT_PUBLIC_SCOUT_FAKE_HOSTED: "1",
    }),
    true,
  );
});

test("a production build with the fake flag set is refused", () => {
  assert.throws(
    () =>
      assertNoFakeInProduction({
        NODE_ENV: "production",
        NEXT_PUBLIC_SCOUT_FAKE_HOSTED: "1",
      }),
    /dev and e2e servers only/,
  );
  assert.doesNotThrow(() =>
    assertNoFakeInProduction({ NODE_ENV: "production" }),
  );
  assert.doesNotThrow(() =>
    assertNoFakeInProduction({
      NODE_ENV: "development",
      NEXT_PUBLIC_SCOUT_FAKE_HOSTED: "1",
    }),
  );
});

test("the fake keeps a topic's brief settings and refuses bad ones", async () => {
  const data = createFakeHostedData();
  await data.setBriefSettings("power", { length: "long", stories: "relevant" });
  const power = (await data.home()).interests.find((i) => i.id === "power");
  assert.equal(power?.settings.length, "long");
  assert.equal(power?.settings.stories, "relevant");
  await assert.rejects(data.setBriefSettings("power", { stories: 99 }));
});
