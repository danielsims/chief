import assert from "node:assert/strict";
import test from "node:test";

import type { StartOptions } from "../src/types.js";
import { AcpDriver } from "../src/drivers/acp.js";
import { CodexDriver } from "../src/drivers/codex.js";

class StartupDriver extends CodexDriver {
  readonly delays: number[] = [];
  protected override waitBeforeRetry(delay: number) {
    this.delays.push(delay);
    return Promise.resolve();
  }
}

const options: StartOptions = {
  cwd: "/tmp",
  instructions: "Test",
  access: "guarded",
};
const sqliteFailure = new Error(
  "Codex process has exited with code 1: Error: failed to initialize sqlite state runtime under /tmp/chief",
);

void test("Codex recovers a concurrent SQLite initialization failure before surfacing an interrupted run", async (t) => {
  let attempts = 0;
  const start = t.mock.method(AcpDriver.prototype, "start", () =>
    ++attempts === 1 ? Promise.reject(sqliteFailure) : Promise.resolve(),
  );
  const stop = t.mock.method(AcpDriver.prototype, "stop", () =>
    Promise.resolve(),
  );
  const driver = new StartupDriver();
  const events: unknown[] = [];
  driver.on("event", (event) => events.push(event));
  await driver.start(options);
  assert.equal(start.mock.callCount(), 2);
  assert.equal(stop.mock.callCount(), 1);
  assert.deepEqual(driver.delays, [250]);
  assert.deepEqual(events, []);
});

void test("Codex bounds SQLite startup retries and propagates unrelated failures immediately", async (t) => {
  const start = t.mock.method(AcpDriver.prototype, "start", () =>
    Promise.reject(sqliteFailure),
  );
  t.mock.method(AcpDriver.prototype, "stop", () => Promise.resolve());
  const driver = new StartupDriver();
  await assert.rejects(driver.start(options), sqliteFailure);
  assert.equal(start.mock.callCount(), 3);
  assert.deepEqual(driver.delays, [250, 500]);
  start.mock.mockImplementation(() =>
    Promise.reject(new Error("Authentication required")),
  );
  await assert.rejects(driver.start(options), /Authentication required/u);
  assert.equal(start.mock.callCount(), 4);
});
