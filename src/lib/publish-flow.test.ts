import assert from "node:assert/strict";
import test from "node:test";

import { HostedError, type HostedData } from "./hosted";
import { checkAndPublish, followersLabel, hasPublicRoom } from "./publish-flow";

// The publish sheet's states, from a stubbed HostedData.publish.

const stub = (publish: HostedData["publish"]) => ({ publish });

test("approved: public with its slug and Scout's tags", async () => {
  const state = await checkAndPublish(
    stub(async () => ({
      status: "public",
      slug: "abc",
      tags: ["climate", "norway"],
    })),
    "interest-1",
  );
  assert.deepEqual(state, {
    kind: "public",
    slug: "abc",
    tags: ["climate", "norway"],
  });
});

test("refused: the reason Scout gave", async () => {
  const state = await checkAndPublish(
    stub(async () => ({
      status: "refused",
      reason: "It names a private person.",
    })),
    "interest-1",
  );
  assert.deepEqual(state, {
    kind: "refused",
    reason: "It names a private person.",
  });
});

test("the plan's limit is its own state, other errors are failed", async () => {
  const limit = await checkAndPublish(
    stub(async () => {
      throw new HostedError("limit", "You have 3 public topics already.");
    }),
    "interest-1",
  );
  assert.deepEqual(limit, {
    kind: "limit",
    message: "You have 3 public topics already.",
  });

  const failed = await checkAndPublish(
    stub(async () => {
      throw new HostedError("failed", "Scout is busy.");
    }),
    "interest-1",
  );
  assert.deepEqual(failed, { kind: "failed", message: "Scout is busy." });

  const network = await checkAndPublish(
    stub(async () => {
      throw new TypeError("fetch failed");
    }),
    "interest-1",
  );
  assert.equal(network.kind, "failed");
});

test("a signed-out reader is thrown on, for the page to send to sign in", async () => {
  await assert.rejects(
    checkAndPublish(
      stub(async () => {
        throw new HostedError("signed-out", "Sign in first.");
      }),
      "interest-1",
    ),
    (err: unknown) => err instanceof HostedError && err.kind === "signed-out",
  );
});

test("room for one more public topic, and follower counts", () => {
  assert.equal(hasPublicRoom(2, 3), true);
  assert.equal(hasPublicRoom(3, 3), false);
  assert.equal(followersLabel(0), "0 followers");
  assert.equal(followersLabel(1), "1 follower");
  assert.equal(followersLabel(1000), "1k followers");
  assert.equal(followersLabel(1450), "1.4k followers");
  assert.equal(followersLabel(12_400), "12k followers");
});
