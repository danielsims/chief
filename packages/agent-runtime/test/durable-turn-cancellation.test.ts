import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentInference,
  AgentInferenceResult,
} from "@chief/agent-computer";

import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";

void test("a cancelled inference cannot overwrite its replacement turn", async () => {
  const persistence = new MemoryCellPersistence();
  let release: ((result: AgentInferenceResult) => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const inference: AgentInference = {
    model: {
      id: "test-model",
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 4_000,
      limitSource: "provider",
    },
    estimateTokens: () => 10,
    complete: () =>
      new Promise<AgentInferenceResult>((resolve) => {
        release = resolve;
        markStarted?.();
      }),
  };
  const first = runner(persistence);
  await first.create(baseTurn());
  const advancing = first.advance({
    inference,
    tools: [],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
  await started;

  await runner(persistence).cancelActive();
  await runner(persistence).create({
    ...baseTurn(),
    jobId: "job-2",
    leaseToken: "lease-2",
    instruction: "Use the user's newer instruction.",
  });
  release?.({ content: "stale result", toolCalls: [] });

  assert.deepEqual(await advancing, { kind: "idle" });
  assert.equal((await runner(persistence).active())?.jobId, "job-2");
});

function runner(persistence: MemoryCellPersistence) {
  return new DurableTurnRunner(persistence, "workspace:setup");
}

function baseTurn() {
  return {
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "setup",
    instruction: "Connect Notion.",
    systemPrompt: "You are a setup agent.",
    browserEnabled: false,
  };
}
