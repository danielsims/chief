import assert from "node:assert/strict";
import test from "node:test";

import type { AgentInferenceRequest } from "@chief/agent-computer";

import type { DurableTool } from "../src/durable-turn/types.js";
import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import {
  recentCompleteMessages,
  shouldCompact,
} from "../src/durable-turn/context.js";
import {
  baseTurn,
  fakeInference,
  readTool,
  runner,
} from "./durable-turn-test-support.js";

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

void test("a rejected idempotent tool returns control to the agent", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference(() => {
    modelCalls += 1;
    return modelCalls === 1
      ? {
          content: null,
          toolCalls: [
            {
              id: "browser-1",
              name: "browser_open",
              arguments: { url: "https://example.com" },
            },
          ],
        }
      : {
          content: "The browser failed, so I used another source.",
          toolCalls: [],
        };
  });
  const browser: DurableTool = {
    definition: {
      name: "browser_open",
      description: "Open a page.",
      parameters: { type: "object", properties: {} },
    },
    effect: "idempotent",
  };
  await runner(persistence).create(baseTurn());
  await runner(persistence).advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
  const rejected = await runner(persistence).advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: {
      execute: () => Promise.reject(new Error("browser host timed out")),
    },
  });

  assert.equal(rejected.kind, "advanced");
  assert.deepEqual(rejected.turn.phase, {
    kind: "runnable",
    next: { kind: "infer" },
  });
  assert.deepEqual(rejected.turn.tools[0]?.result, {
    ok: false,
    error: "browser host timed out",
  });

  const completed = await runner(persistence).advance({
    inference,
    tools: [browser],
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });
  assert.equal(completed.kind, "terminal");
  assert.equal(completed.turn.phase.kind, "completed");
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

void test("compacted history retains a complete multi-tool exchange", () => {
  const calls = Array.from({ length: 12 }, (_, index) => ({
    id: `call-${index + 1}`,
    name: "read_probe",
    arguments: { index },
  }));
  const messages = [
    { role: "user" as const, content: "Inspect every source." },
    { role: "assistant" as const, content: null, toolCalls: calls },
    ...calls.map((call) => ({
      role: "tool" as const,
      content: JSON.stringify({ ok: true }),
      toolCallId: call.id,
      name: call.name,
    })),
  ];

  const retained = recentCompleteMessages(messages);

  assert.equal(retained[0]?.role, "assistant");
  assert.equal(retained.length, 13);
  assert.deepEqual(
    retained.slice(1).map((message) => message.toolCallId),
    calls.map((call) => call.id),
  );
});

void test("tool feedback never splits one assistant tool-result batch", async () => {
  const persistence = new MemoryCellPersistence();
  const requests: AgentInferenceRequest[] = [];
  let modelCalls = 0;
  const inference = fakeInference((request) => {
    requests.push(request);
    modelCalls += 1;
    if (modelCalls === 1) {
      return {
        content: null,
        toolCalls: [
          { id: "probe-1", name: "read_probe", arguments: { query: "same" } },
        ],
      };
    }
    if (modelCalls === 2) {
      return {
        content: null,
        toolCalls: [
          { id: "probe-2", name: "read_probe", arguments: { query: "same" } },
          { id: "probe-3", name: "read_probe", arguments: { query: "other" } },
        ],
      };
    }
    return { content: "done", toolCalls: [] };
  });
  await runner(persistence).create(baseTurn());
  for (let boundary = 0; boundary < 6; boundary += 1) {
    await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: {
        execute: () => Promise.resolve({ ok: true }),
      },
    });
  }

  const continuation = requests[2];
  assert.ok(continuation);
  const secondBatchIndex = continuation.messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.toolCalls?.some((call) => call.id === "probe-2"),
  );
  assert.notEqual(secondBatchIndex, -1);
  const secondBatch = continuation.messages.slice(
    secondBatchIndex,
    secondBatchIndex + 3,
  );
  assert.deepEqual(
    secondBatch.map((message) => message.role),
    ["assistant", "tool", "tool"],
  );
});

void test("storage pressure compacts and bounds long-running tool evidence", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference((request) => {
    if (request.tools.length === 0) {
      return {
        content: JSON.stringify({
          objective: "Complete the durable task.",
          completed: [],
          active: ["Continue gathering evidence"],
          criticalContext: [],
          verifiedEvidence: [],
          artifacts: [],
          failedApproaches: [],
          constraints: [],
          nextAction: "Continue with the next probe.",
          openQuestions: [],
        }),
        toolCalls: [],
      };
    }
    modelCalls += 1;
    return {
      content: null,
      toolCalls: [
        {
          id: `large-${modelCalls}`,
          name: "read_probe",
          arguments: { query: modelCalls },
        },
      ],
    };
  });
  await runner(persistence).create(baseTurn());

  for (let boundary = 0; boundary < 80; boundary += 1) {
    await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: {
        execute: () =>
          Promise.resolve({ content: "x".repeat(40_000), call: modelCalls }),
      },
    });
  }

  const turn = await runner(persistence).active();
  assert.ok(turn?.checkpoint);
  assert.ok(turn.tools.length < 12);
  assert.ok(JSON.stringify(turn).length < 400_000);
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

void test("a visible browser request cannot finish before the page is open", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference(() => {
    modelCalls += 1;
    if (modelCalls === 1) {
      return { content: "On it, opening TikTok now.", toolCalls: [] };
    }
    if (modelCalls === 2) {
      return {
        content: null,
        toolCalls: [
          {
            id: "browser-1",
            name: "browser_open",
            arguments: { url: "https://www.tiktok.com/" },
          },
        ],
      };
    }
    return { content: "TikTok is open in the browser.", toolCalls: [] };
  });
  await runner(persistence).create({
    ...baseTurn(),
    completion: {
      requiredToolNames: ["browser_open"],
      browserMustRemainOpen: true,
    },
  });
  const browserTool: DurableTool = {
    definition: {
      name: "browser_open",
      description: "Open the visible browser.",
      parameters: { type: "object", properties: {} },
    },
    effect: "non_replayable",
  };
  for (let step = 0; step < 4; step += 1) {
    await runner(persistence).advance({
      inference,
      tools: [browserTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: {
        execute: () =>
          Promise.resolve({ url: "https://www.tiktok.com/", title: "TikTok" }),
      },
    });
  }
  const turn = await runner(persistence).active();
  assert.equal(modelCalls, 3);
  assert.deepEqual(turn?.phase, {
    kind: "completed",
    result: "TikTok is open in the browser.",
  });
});

void test("a bare speaker label is rejected as an empty response", async () => {
  const persistence = new MemoryCellPersistence();
  await runner(persistence).create(baseTurn());
  await assert.rejects(
    runner(persistence).advance({
      inference: fakeInference(() => ({
        content: "engineer: ",
        toolCalls: [],
      })),
      tools: [],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.resolve(null) },
    }),
    /empty response/u,
  );
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

void test("a durable turn forwards provider-neutral inference progress before completion", async () => {
  const persistence = new MemoryCellPersistence();
  const events: string[] = [];
  await runner(persistence).create(baseTurn());

  await runner(persistence).advance({
    inference: {
      complete: async (_request, onProgress) => {
        await onProgress?.({
          type: "reasoning",
          delta: "Inspecting ",
          text: "Inspecting ",
        });
        await onProgress?.({
          type: "reasoning",
          delta: "the workspace.",
          text: "Inspecting the workspace.",
        });
        events.push("provider:completed");
        return {
          content: "Done.",
          reasoning: "Inspecting the workspace.",
          toolCalls: [],
        };
      },
    },
    tools: [],
    observer: {
      inferenceProgress: (_turn, progress) => {
        events.push(`progress:${progress.text}`);
      },
      inferenceCompleted: () => {
        events.push("observer:completed");
      },
    },
    scheduleRecovery: () => Promise.resolve(),
    executor: { execute: () => Promise.resolve(null) },
  });

  assert.deepEqual(events, [
    "progress:Inspecting ",
    "progress:Inspecting the workspace.",
    "provider:completed",
    "observer:completed",
  ]);
});
