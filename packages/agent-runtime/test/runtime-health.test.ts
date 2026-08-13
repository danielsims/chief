import assert from "node:assert/strict";
import test from "node:test";

import { runtimeHealthResponse } from "../src/runtime-health.js";

void test("a ready runtime health check never waits behind database work", () => {
  const response = runtimeHealthResponse();

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-chief-runtime"], "ready");
  assert.equal(response.headers["x-chief-runtime-protocol"], "2");
  assert.equal(response.body, "chief-runtime-ready");
  assert.equal("then" in response, false);
});
