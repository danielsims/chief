import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentInference,
  AgentInferenceResult,
} from "@chief/agent-computer";

import type { DurableTool } from "../src/durable-turn/types.js";
import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";
import { RecoverableToolError } from "../src/durable-turn/tool-errors.js";

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
