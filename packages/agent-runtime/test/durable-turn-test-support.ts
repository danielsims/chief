import type {
  AgentInference,
  AgentInferenceRequest,
  AgentInferenceResult,
} from "@chief/agent-computer";

import type { MemoryCellPersistence } from "../src/cells/memory-persistence.js";
import type { DurableTool } from "../src/durable-turn/types.js";
import { DurableTurnRunner } from "../src/durable-turn/runner.js";

export const readTool: DurableTool = {
  definition: {
    name: "read_probe",
    description: "Read a probe value.",
    parameters: { type: "object", properties: {} },
  },
  effect: "read_only",
};

export function runner(persistence: MemoryCellPersistence) {
  return new DurableTurnRunner(persistence, "workspace:engineer");
}

export function baseTurn() {
  return {
    jobId: "job-1",
    leaseToken: "lease-1",
    conversationId: "mission-control",
    instruction: "Complete the durable task.",
    systemPrompt: "You are an engineering agent.",
    browserEnabled: false,
  };
}

export function fakeInference(
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
