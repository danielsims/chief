import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
} from "@chief/agent-computer";

import type { DurableTool } from "../src/durable-turn/types.js";
import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import { shouldCompact } from "../src/durable-turn/context.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";

const readTool: DurableTool = {
  definition: {
    name: "read_probe",
    description: "Read a probe value.",
    parameters: { type: "object", properties: {} },
  },
  effect: "read_only",
};

void test("a turn completes after 120 committed boundaries with a fresh runner each time", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  let toolCalls = 0;
  const inference = fakeInference(() => {
    modelCalls += 1;
    return modelCalls <= 60
      ? {
          content: null,
          toolCalls: [
            { id: `call-${modelCalls}`, name: "read_probe", arguments: {} },
          ],
        }
      : { content: "durable result", toolCalls: [] };
  });
  await runner(persistence).create(baseTurn());

  for (let boundary = 0; boundary < 121; boundary += 1) {
    const result = await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: {
        execute: () => {
          toolCalls += 1;
          return Promise.resolve({ ok: true, toolCalls });
        },
      },
    });
    if (result.kind === "terminal") break;
  }

  const completed = await runner(persistence).active();
  assert.ok(completed);
  assert.equal(completed.phase.kind, "completed");
  assert.equal(modelCalls, 61);
  assert.equal(toolCalls, 60);
  assert.ok(completed.revision >= 121);
});

void test("an interrupted non-replayable tool pauses instead of replaying", async () => {
  const persistence = new MemoryCellPersistence();
  const dangerous: DurableTool = {
    definition: {
      name: "send_once",
      description: "Send once.",
      parameters: { type: "object", properties: {} },
    },
    effect: "non_replayable",
  };
  const inference = fakeInference(() => ({
    content: null,
    toolCalls: [{ id: "send-1", name: "send_once", arguments: {} }],
  }));
  const first = runner(persistence);
  await first.create(baseTurn());
  await first.advance({
    inference,
    tools: [dangerous],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
  const result = await runner(persistence).advance({
    inference,
    tools: [dangerous],
    scheduleRecovery: () => Promise.resolve(),
    executor: {
      execute: () => Promise.reject(new Error("connection vanished")),
    },
  });
  assert.equal(result.kind, "terminal");
  assert.deepEqual(result.turn.phase, {
    kind: "needs_attention",
    reason: "ambiguous_effect",
    message:
      "Chief cannot verify whether send_once completed before it failed.",
  });
});

void test("compaction uses the model context window and configurable ratio", async () => {
  const persistence = new MemoryCellPersistence();
  const turn = await runner(persistence).create(baseTurn());
  const inference = fakeInference(
    () => ({ content: "unused", toolCalls: [] }),
    { contextWindowTokens: 100, estimateTokens: 75 },
  );
  assert.equal(
    shouldCompact({
      inference,
      turn,
      tools: [],
      maxOutputTokens: 10,
      policy: { compactionRatio: 0.75 },
    }),
    true,
  );
  assert.equal(
    shouldCompact({
      inference,
      turn,
      tools: [],
      maxOutputTokens: 10,
      policy: { compactionRatio: 0.8 },
    }),
    false,
  );
});

void test("an agent cannot finish while its durable plan still has open work", async () => {
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
            arguments: { tasks: [{ text: "Verify the result" }] },
          },
        ],
      };
    }
    if (call === 2) return { content: "premature", toolCalls: [] };
    if (call === 3) {
      return {
        content: null,
        toolCalls: [
          {
            id: "plan-complete",
            name: "todo_update",
            arguments: { id: 1, status: "completed" },
          },
        ],
      };
    }
    return { content: "verified result", toolCalls: [] };
  });
  await runner(persistence).create(baseTurn());
  for (let step = 0; step < 6; step += 1) {
    await runner(persistence).advance({
      inference,
      tools: [],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.resolve(null) },
    });
  }
  const turn = await runner(persistence).active();
  assert.ok(turn);
  assert.deepEqual(turn.phase, {
    kind: "completed",
    result: "verified result",
  });
  const task = turn.plan.tasks[0];
  assert.ok(task);
  assert.equal(task.status, "completed");
  assert.notEqual(task.evidence, "plan-complete");
});

void test("a durable turn reports inference and tool lifecycle boundaries", async () => {
  const persistence = new MemoryCellPersistence();
  const events: string[] = [];
  const observer = {
    inferenceStarted: () => {
      events.push("inference:started");
    },
    inferenceCompleted: () => {
      events.push("inference:completed");
    },
    toolStarted: () => {
      events.push("tool:started");
    },
    toolCompleted: () => {
      events.push("tool:completed");
    },
  };
  const inference = fakeInference(() => ({
    content: null,
    toolCalls: [{ id: "probe-1", name: "read_probe", arguments: {} }],
  }));
  await runner(persistence).create(baseTurn());

  await runner(persistence).advance({
    inference,
    tools: [readTool],
    observer,
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve({ ok: true }) },
  });
  await runner(persistence).advance({
    inference,
    tools: [readTool],
    observer,
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve({ ok: true }) },
  });

  assert.deepEqual(events, [
    "inference:started",
    "inference:completed",
    "tool:started",
    "tool:completed",
  ]);
});

function runner(persistence: MemoryCellPersistence) {
  return new DurableTurnRunner(persistence, "workspace:engineer");
}

function baseTurn() {
  return {
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "mission-control",
    instruction: "Complete the durable task.",
    systemPrompt: "You are an engineering agent.",
    browserEnabled: false,
  };
}

function fakeInference(
  respond: (request: AgentInferenceRequest) => AgentInferenceResult,
  options: { contextWindowTokens?: number; estimateTokens?: number } = {},
): AgentInference {
  return {
    model: {
      id: "test-model",
      contextWindowTokens: options.contextWindowTokens ?? 1_000_000,
      maxOutputTokens: 4_000,
      limitSource: "provider",
    },
    estimateTokens: () => options.estimateTokens ?? 10,
    complete: (request) => Promise.resolve(respond(request)),
  };
}
