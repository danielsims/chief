import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentInference,
  AgentInferenceResult,
} from "@chief/agent-computer";

import type { DurableTool } from "../src/durable-turn/types.js";
import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";
import {
  DeferredToolError,
  RecoverableToolError,
  UnavailableToolError,
} from "../src/durable-turn/tool-errors.js";

void test("a deferred tool sleeps without returning a failure to the model", async () => {
  const persistence = new MemoryCellPersistence();
  const runner = new DurableTurnRunner(persistence, "workspace:prospector");
  const wakeAt = Date.now() + 20_000;
  const scheduled: number[] = [];
  let failedObservations = 0;
  const inference: AgentInference = {
    estimateTokens: () => 10,
    complete: () =>
      Promise.resolve({
        content: null,
        toolCalls: [
          {
            id: "open-1",
            name: "browser_open",
            arguments: { url: "https://example.com" },
          },
        ],
      }),
  };
  const browser: DurableTool = {
    definition: {
      name: "browser_open",
      description: "Open a browser page.",
      parameters: { type: "object", properties: {} },
    },
    effect: "idempotent",
  };
  await runner.create({
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "prospecting",
    instruction: "Research the company.",
    systemPrompt: "You are the Prospector.",
    browserEnabled: true,
  });
  await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });

  const deferred = await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: (scheduledAt) => {
      scheduled.push(scheduledAt);
      return Promise.resolve();
    },
    executor: {
      execute: () =>
        Promise.reject(
          new DeferredToolError(
            "Browser capacity is temporarily full.",
            wakeAt,
          ),
        ),
    },
    observer: {
      toolFailed: () => {
        failedObservations += 1;
      },
    },
  });

  assert.equal(deferred.kind, "sleeping");
  assert.equal(scheduled.at(-1), wakeAt);
  assert.ok(scheduled.some((scheduledAt) => scheduledAt > wakeAt));
  assert.equal(failedObservations, 0);
  const active = await runner.active();
  assert.ok(active);
  assert.equal(active.tools[0]?.state, "prepared");
  assert.deepEqual(active.phase, {
    kind: "runnable",
    next: { kind: "tool", callId: "open-1" },
  });
});

void test("a recoverable non-replayable browser failure returns control to the agent", async () => {
  const persistence = new MemoryCellPersistence();
  const runner = new DurableTurnRunner(persistence, "workspace:marketer");
  let modelCalls = 0;
  const inference: AgentInference = {
    estimateTokens: () => 10,
    complete: () => {
      modelCalls += 1;
      const result: AgentInferenceResult =
        modelCalls === 1
          ? {
              content: null,
              toolCalls: [
                {
                  id: "click-1",
                  name: "browser_click",
                  arguments: {},
                },
              ],
            }
          : { content: "I inspected the page and recovered.", toolCalls: [] };
      return Promise.resolve(result);
    },
  };
  const browser: DurableTool = {
    definition: {
      name: "browser_click",
      description: "Click a browser control.",
      parameters: { type: "object", properties: {} },
    },
    effect: "non_replayable",
  };
  await runner.create({
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "marketing",
    instruction: "Complete the browser task.",
    systemPrompt: "You are the Marketer.",
    browserEnabled: true,
  });
  await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
  const rejected = await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: {
      execute: () =>
        Promise.reject(new RecoverableToolError("target disappeared")),
    },
  });

  assert.equal(rejected.kind, "advanced");
  assert.deepEqual(rejected.turn.phase, {
    kind: "runnable",
    next: { kind: "infer" },
  });
  assert.deepEqual(rejected.turn.tools[0]?.result, {
    ok: false,
    error: "target disappeared",
  });
});

void test("an unavailable browser is removed while the agent completes the turn", async () => {
  const persistence = new MemoryCellPersistence();
  const runner = new DurableTurnRunner(persistence, "workspace:prospector");
  const visibleTools: string[][] = [];
  let modelCalls = 0;
  const inference: AgentInference = {
    estimateTokens: () => 10,
    complete: (request) => {
      visibleTools.push(request.tools.map((tool) => tool.name));
      modelCalls += 1;
      return Promise.resolve(
        modelCalls === 1
          ? {
              content: null,
              toolCalls: [
                {
                  id: "browser-capacity",
                  name: "browser_open",
                  arguments: { url: "https://example.com" },
                },
              ],
            }
          : {
              content: "I continued without the unavailable browser.",
              toolCalls: [],
            },
      );
    },
  };
  const browser: DurableTool = {
    definition: {
      name: "browser_open",
      description: "Open a page.",
      parameters: { type: "object", properties: {} },
    },
    effect: "idempotent",
  };
  await runner.create({
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "prospecting",
    instruction: "Research the company.",
    systemPrompt: "You are the Prospector.",
    browserEnabled: true,
  });
  await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
  await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: {
      execute: () =>
        Promise.reject(new UnavailableToolError("Browser capacity is full.")),
    },
  });
  const completed = await runner.advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });

  assert.equal(completed.kind, "terminal");
  assert.equal(visibleTools[0]?.includes("browser_open"), true);
  assert.equal(visibleTools[1]?.includes("browser_open"), false);
});
