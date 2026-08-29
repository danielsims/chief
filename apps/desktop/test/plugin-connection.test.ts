import assert from "node:assert/strict";
import test from "node:test";

import { connectRecommendedPlugin } from "../src/lib/plugin-connection.js";

void test("a recommended plugin installs locally and opens its authorization flow", async () => {
  const calls: string[] = [];
  await connectRecommendedPlugin(
    { id: "notion", status: "available" },
    {
      install: (id) => {
        calls.push(`install:${id}`);
        return Promise.resolve(undefined);
      },
      authorize: (id) => {
        calls.push(`authorize:${id}`);
        return Promise.resolve(undefined);
      },
    },
  );

  assert.deepEqual(calls, ["install:notion", "authorize:notion"]);
});

void test("an installed recommendation authorizes without reinstalling", async () => {
  const calls: string[] = [];
  await connectRecommendedPlugin(
    { id: "notion", status: "authorization_required" },
    {
      install: (id) => {
        calls.push(`install:${id}`);
        return Promise.resolve(undefined);
      },
      authorize: (id) => {
        calls.push(`authorize:${id}`);
        return Promise.resolve(undefined);
      },
    },
  );

  assert.deepEqual(calls, ["authorize:notion"]);
});
