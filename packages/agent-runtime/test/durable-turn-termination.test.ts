import assert from "node:assert/strict";
import test from "node:test";

import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import {
  baseTurn,
  fakeInference,
  readTool,
  runner,
} from "./durable-turn-test-support.js";

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

void test("a durable turn retries one empty finalization and preserves enough output budget", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const finalizationBudgets: number[] = [];
  const inference = fakeInference((request) => {
    modelCalls += 1;
    if (request.tools.length > 0) {
      return {
        content: null,
        toolCalls: [
          {
            id: "probe-1",
            name: "read_probe",
            arguments: { query: "bounded" },
          },
        ],
      };
    }
    finalizationBudgets.push(request.maxTokens ?? 0);
    if (finalizationBudgets.length === 1) {
      return {
        content: null,
        reasoning: "I need to summarize the verified result.",
        toolCalls: [],
      };
    }
    assert.ok(
      request.messages.some((message) =>
        /Return the concise final update now/iu.test(message.content ?? ""),
      ),
    );
    return {
      content: "I verified one useful result and stopped at the work limit.",
      toolCalls: [],
    };
  });
  await runner(persistence).create({ ...baseTurn(), maxInferenceSteps: 1 });

  let terminal;
  for (let step = 0; step < 6; step += 1) {
    const result = await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.resolve({ value: "verified" }) },
    });
    if (result.kind === "terminal") {
      terminal = result;
      break;
    }
  }

  assert.ok(terminal);
  assert.equal(modelCalls, 3);
  assert.deepEqual(finalizationBudgets, [4_000, 4_000]);
  assert.deepEqual(terminal.turn.phase, {
    kind: "completed",
    result: "I verified one useful result and stopped at the work limit.",
  });
});

void test("an unadvertised tool call is returned to the model as a recoverable failure", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference((request) => {
    modelCalls += 1;
    if (modelCalls === 1) {
      return {
        content: null,
        toolCalls: [
          {
            id: "unknown-1",
            name: "trends_save",
            arguments: { title: "Unsupported" },
          },
        ],
      };
    }
    assert.ok(
      request.messages.some(
        (message) =>
          message.role === "tool" &&
          /Unknown durable tool: trends_save/iu.test(message.content ?? ""),
      ),
    );
    return {
      content:
        "I could not save that record, but I can still report the verified evidence.",
      toolCalls: [],
    };
  });
  await runner(persistence).create(baseTurn());

  let terminal;
  for (let step = 0; step < 4; step += 1) {
    const result = await runner(persistence).advance({
      inference,
      tools: [readTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: {
        execute: (call) =>
          Promise.reject(new Error(`Unknown durable tool: ${call.name}`)),
      },
    });
    if (result.kind === "terminal") {
      terminal = result;
      break;
    }
  }

  assert.ok(terminal);
  assert.deepEqual(terminal.turn.phase, {
    kind: "completed",
    result:
      "I could not save that record, but I can still report the verified evidence.",
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
