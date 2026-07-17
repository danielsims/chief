import assert from "node:assert/strict";
import test from "node:test";

import { transientRetryOutcome } from "../src/retry-policy.js";

void test("a transient runtime failure gets exactly one automatic retry", () => {
  const failure = new Error("RPC timeout while waiting for the local agent");
  const first = transientRetryOutcome(failure, {
    agentId: "analyst",
    lastResult: undefined,
  });

  assert.equal(first.retrying, true);
  assert.match(first.message ?? "", /reconnecting/);

  const second = transientRetryOutcome(failure, {
    agentId: "analyst",
    lastResult: first.message ?? undefined,
  });

  assert.equal(second.retrying, false);
  assert.match(second.message ?? "", /after one automatic retry/);
});

void test("configuration and policy failures never retry", () => {
  const result = transientRetryOutcome(
    new Error("The requested tool is outside the approved grant."),
    { agentId: "analyst", lastResult: undefined },
  );

  assert.deepEqual(result, { retrying: false, message: null });
});
