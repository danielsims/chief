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

void test("a durable turn finalizes an unchanged tool loop without discarding useful work", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference(() => {
    modelCalls += 1;
    if (modelCalls === 4) {
      return {
        content:
          "I could not make further progress because the source kept returning the same result.",
        toolCalls: [],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: `probe-${modelCalls}`,
          name: "read_probe",
          arguments: { query: "unchanged" },
        },
      ],
    };
  });
  await runner(persistence).create(baseTurn());
  let terminal;
  for (let step = 0; step < 7; step += 1) {
    const result = await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.resolve({ value: "same" }) },
    });
    if (result.kind === "terminal") terminal = result;
  }
  assert.ok(terminal);
  assert.equal(terminal.kind, "terminal");
  assert.deepEqual(terminal.turn.phase, {
    kind: "completed",
    result:
      "I could not make further progress because the source kept returning the same result.",
  });
  assert.equal(modelCalls, 4);
});

void test("a durable turn finalizes after its inference budget is exhausted", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference((request) => {
    modelCalls += 1;
    if (request.tools.length === 0) {
      return {
        content:
          "I gathered two useful results before reaching the work limit.",
        toolCalls: [],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: `probe-${modelCalls}`,
          name: "read_probe",
          arguments: { query: modelCalls },
        },
      ],
    };
  });
  await runner(persistence).create({ ...baseTurn(), maxInferenceSteps: 2 });

  let terminal;
  for (let step = 0; step < 6; step += 1) {
    const result = await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.resolve({ value: modelCalls }) },
    });
    if (result.kind === "terminal") {
      terminal = result;
      break;
    }
  }

  assert.ok(terminal);
  assert.equal(modelCalls, 3);
  assert.deepEqual(terminal.turn.phase, {
    kind: "completed",
    result: "I gathered two useful results before reaching the work limit.",
  });
});

void test("a durable turn persists transient interruption attempts", async () => {
  const persistence = new MemoryCellPersistence();
  const durable = runner(persistence);
  await durable.create(baseTurn());
  await durable.deferUntil(Date.now() + 1_000);

  const turn = await durable.active();
  assert.equal(turn?.interruptionCount, 1);
});

void test("a durable turn finalizes after six consecutive tool failures", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference((request) => {
    modelCalls += 1;
    if (request.tools.length === 0) {
      assert.match(
        request.messages.at(-1)?.content ?? "",
        /six consecutive tool failures/iu,
      );
      return {
        content:
          "I could not verify any prospects because every source lookup failed.",
        toolCalls: [],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: `probe-${modelCalls}`,
          name: "read_probe",
          arguments: { query: modelCalls },
        },
      ],
    };
  });
  await runner(persistence).create(baseTurn());

  let terminal;
  for (let step = 0; step < 14; step += 1) {
    const result = await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.reject(new Error("invalid input")) },
    });
    if (result.kind === "terminal") {
      terminal = result;
      break;
    }
  }

  assert.ok(terminal);
  assert.equal(modelCalls, 7);
  assert.deepEqual(terminal.turn.phase, {
    kind: "completed",
    result:
      "I could not verify any prospects because every source lookup failed.",
  });
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
