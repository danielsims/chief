import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent, StartOptions } from "../src/types.js";
import { BaseDriver } from "../src/drivers/base.js";

class RetryDriver extends BaseDriver {
  attempts = 0;
  restarts = 0;
  failures = 0;
  outputBeforeFailure = false;

  start(_options: StartOptions) {
    return Promise.resolve();
  }

  sendPromptOnce() {
    this.attempts += 1;
    if (this.failures <= 0) return Promise.resolve();
    this.failures -= 1;
    if (this.outputBeforeFailure) {
      this.emitEvent({ type: "stream", text: "Partial response" });
    }
    return Promise.reject(new Error("temporary failure"));
  }

  restart() {
    this.restarts += 1;
    return Promise.resolve();
  }

  interrupt() {
    this.interrupted = true;
    return Promise.resolve();
  }

  stop() {
    return Promise.resolve();
  }

  protected override waitBeforeRetry() {
    return Promise.resolve();
  }
}

class AsyncRetryDriver extends RetryDriver {
  protected override promptCompletesFromEvents = true;

  override sendPromptOnce() {
    this.attempts += 1;
    queueMicrotask(() => {
      if (this.attempts === 1) {
        this.emitEvent({ type: "error", message: "stream disconnected" });
      } else {
        this.emitEvent({ type: "result", ok: true });
      }
    });
    return Promise.resolve();
  }
}

void test("retries a failed prompt after restarting the backend", async () => {
  const driver = new RetryDriver();
  driver.failures = 1;

  await driver.sendPrompt("Run onboarding");

  assert.equal(driver.attempts, 2);
  assert.equal(driver.restarts, 1);
});

void test("partial output prevents a duplicate retry and rejects the send", async () => {
  const driver = new RetryDriver();
  const events: AgentEvent[] = [];
  driver.failures = 1;
  driver.outputBeforeFailure = true;
  driver.on("event", (event: AgentEvent) => events.push(event));

  await assert.rejects(
    () => driver.sendPrompt("Run onboarding"),
    /temporary failure/,
  );

  assert.equal(driver.attempts, 1);
  assert.equal(driver.restarts, 0);
  assert.ok(events.some((event) => event.type === "error"));
});

void test("a previous interrupt does not disable retries on the next prompt", async () => {
  const driver = new RetryDriver();
  await driver.interrupt();
  driver.failures = 1;

  await driver.sendPrompt("Try again");

  assert.equal(driver.attempts, 2);
  assert.equal(driver.restarts, 1);
});

void test("a user-action failure is not retried", async () => {
  const driver = new RetryDriver();
  driver.failures = 1;
  driver.sendPromptOnce = () => {
    driver.attempts += 1;
    return Promise.reject(new Error("Sign-in required"));
  };

  await assert.rejects(
    () => driver.sendPrompt("Connect the account"),
    /Sign-in/,
  );

  assert.equal(driver.attempts, 1);
  assert.equal(driver.restarts, 0);
});

void test("an asynchronous provider failure stays hidden while the turn retries", async () => {
  const driver = new AsyncRetryDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  await driver.sendPrompt("Run onboarding");

  assert.equal(driver.attempts, 2);
  assert.equal(driver.restarts, 1);
  assert.equal(
    events.some((event) => event.type === "error"),
    false,
  );
  assert.equal(
    events.some((event) => event.type === "result" && event.ok),
    true,
  );
});
