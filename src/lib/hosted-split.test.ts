import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createHostedData } from "./hosted";
import { accountData } from "./hosted/account";
import { catalogData } from "./hosted/catalog";
import { chatData } from "./hosted/chat";
import { hostedClient } from "./hosted/client";
import { homeData } from "./hosted/home";
import { marksData } from "./hosted/marks";
import { pushData } from "./hosted/push";
import { sharingData } from "./hosted/sharing";

// hosted.ts composes one module per area. Each method comes from exactly one
// area: a name in two would be silently overwritten by the later spread.

const deps = {
  supabaseUrl: "https://db.test",
  anonKey: "anon",
  workerUrl: "https://worker.test",
  session: () => Promise.resolve(null),
  fetch: () => Promise.reject(new Error("no network in tests")),
};

test("every HostedData method comes from exactly one area module", () => {
  const c = hostedClient(deps);
  const areas = [
    pushData,
    homeData,
    chatData,
    sharingData,
    catalogData,
    accountData,
    marksData,
  ].map((area) => Object.keys(area(c)));
  const all = areas.flat();
  assert.deepEqual(
    all.filter((k, i) => all.indexOf(k) !== i),
    [],
    "a method defined in two areas",
  );
  assert.deepEqual([...all].sort(), Object.keys(createHostedData(deps)).sort());
});

test("hosted.ts stays a small entry that composes the areas", () => {
  const entry = readFileSync(new URL("./hosted.ts", import.meta.url), "utf8");
  assert.ok(entry.split("\n").length < 150, "hosted.ts grew past an entry");
  assert.doesNotMatch(entry, /rest</, "REST calls belong in an area module");
});
