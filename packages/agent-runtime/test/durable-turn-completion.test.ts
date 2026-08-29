import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
} from "@chief/agent-computer";

import type { DurableTool } from "../src/durable-turn/types.js";
import { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";

void test("a failed tool result does not satisfy a completion requirement", async () => {
  const persistence = new MemoryCellPersistence();
  let modelCalls = 0;
  const inference = fakeInference(() => {
    modelCalls += 1;
    if (modelCalls === 1) {
      return {
        content: null,
        toolCalls: [
          {
            id: "create-1",
            name: "channels_create",
            arguments: { name: "engineering-kickoff" },
          },
        ],
      };
    }
    return { content: "The channel is live.", toolCalls: [] };
  });
  const runner = new DurableTurnRunner(persistence, "workspace:engineer");
  await runner.create({
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "mission-control",
    instruction: "Create the engineering kickoff channel.",
    systemPrompt: "Complete the tool-backed request.",
    browserEnabled: false,
    completion: {
      requiredToolNames: ["channels_create"],
      browserMustRemainOpen: false,
    },
  });
  const channelTool: DurableTool = {
    definition: {
      name: "channels_create",
      description: "Create a channel.",
      parameters: { type: "object", properties: {} },
    },
    effect: "idempotent",
  };
  for (let step = 0; step < 3; step += 1) {
    await runner.advance({
      inference,
      tools: [channelTool],
      scheduleRecovery: () => Promise.resolve(),
      executor: { execute: () => Promise.resolve({ ok: false }) },
    });
  }

  const turn = await runner.active();
  assert.ok(turn);
  assert.equal(turn.phase.kind, "runnable");
  assert.equal(turn.completion.rejectedFinishes, 1);
});

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
