import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
} from "@chief/agent-computer";

import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";

void test("a turn completes when its remaining task is waiting on the user", async () => {
  const persistence = new MemoryCellPersistence();
  let call = 0;
  const inference = fakeInference(() => {
    call += 1;
    if (call === 1) {
      return {
        content: null,
        toolCalls: [
          {
            id: "plan-set",
            name: "todo_set",
            arguments: { tasks: [{ text: "Wait for authorization" }] },
          },
        ],
      };
    }
    if (call === 2) {
      return {
        content: null,
        toolCalls: [
          {
            id: "plan-wait",
            name: "todo_update",
            arguments: { id: 1, status: "waiting" },
          },
        ],
      };
    }
    return {
      content: "Authorize the cards when you are ready.",
      toolCalls: [],
    };
  });
  await runner(persistence).create(baseTurn());

  let terminal;
  for (let step = 0; step < 5; step += 1) {
    const result = await advance(persistence, inference);
    if (result.kind === "terminal") terminal = result;
  }

  assert.ok(terminal);
  assert.equal(terminal.kind, "terminal");
  assert.deepEqual(terminal.turn.phase, {
    kind: "completed",
    result: "Authorize the cards when you are ready.",
  });
  assert.equal(terminal.turn.plan.tasks[0]?.status, "waiting");
  assert.equal(call, 3);
});

void test("a turn stops when it repeats a final response without plan progress", async () => {
  const persistence = new MemoryCellPersistence();
  let call = 0;
  const inference = fakeInference(() => {
    call += 1;
    if (call === 1) {
      return {
        content: null,
        toolCalls: [
          {
            id: "plan-set",
            name: "todo_set",
            arguments: { tasks: [{ text: "Verify authorization" }] },
          },
        ],
      };
    }
    return { content: "Authorize the cards when ready.", toolCalls: [] };
  });
  await runner(persistence).create(baseTurn());

  let terminal;
  for (let step = 0; step < 4; step += 1) {
    const result = await advance(persistence, inference);
    if (result.kind === "terminal") terminal = result;
  }

  assert.ok(terminal);
  assert.equal(terminal.kind, "terminal");
  assert.deepEqual(terminal.turn.phase, {
    kind: "failed",
    error:
      "Agent stopped after repeating the same final response without advancing its durable plan.",
  });
  assert.equal(call, 3);
});

function runner(persistence: MemoryCellPersistence) {
  return new DurableTurnRunner(persistence, "workspace:setup");
}

function advance(
  persistence: MemoryCellPersistence,
  inference: AgentInference,
) {
  return runner(persistence).advance({
    inference,
    tools: [],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
}

function baseTurn() {
  return {
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "setup",
    instruction: "Complete the setup task.",
    systemPrompt: "You are the Setup agent.",
    browserEnabled: false,
  };
}

function fakeInference(
  respond: (request: AgentInferenceRequest) => AgentInferenceResult,
): AgentInference {
  return {
    model: {
      id: "test-model",
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 4_000,
      limitSource: "provider",
    },
    estimateTokens: () => 10,
    complete: (request) => Promise.resolve(respond(request)),
  };
}
