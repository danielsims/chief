import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";

import type { AgentObject } from "../src/agent-object";
import { agentCellPersistence } from "../src/agent-cell-storage";
import { hostedInferenceActivitySeed } from "../src/agent-hosted-activity";
import { relayTestEnv } from "./helpers";

describe("Cloudflare durable turn persistence", () => {
  it("keeps each inference step as a distinct activity entry", () => {
    expect(hostedInferenceActivitySeed({ revision: 4 })).toBe("thinking:4");
    expect(hostedInferenceActivitySeed({ revision: 9 })).toBe("thinking:9");
  });

  it("resumes the next committed boundary after object eviction", async () => {
    const relay = relayTestEnv();
    const stub = relay.AGENTS.get(relay.AGENTS.idFromName("durable:engineer"));

    await runInDurableObject(stub, async (_instance: AgentObject, state) => {
      const runner = turnRunner(state.storage);
      await runner.create({
        jobId: "job-1",
        leaseToken: "lease-1",
        conversationId: "mission-control",
        instruction: "Read the durable probe and answer.",
        systemPrompt: "You are an engineering agent.",
        browserEnabled: false,
      });
      const advanced = await runner.advance({
        inference: inference({
          content: null,
          toolCalls: [{ id: "probe-1", name: "probe", arguments: {} }],
        }),
        tools: [probeTool],
        scheduleRecovery: async (wakeAt) =>
          await state.storage.setAlarm(wakeAt),
        executor: { execute: () => Promise.resolve({ value: "durable" }) },
      });
      expect(advanced.kind).toBe("advanced");
    });

    await evictDurableObject(stub);
    await runInDurableObject(stub, async (_instance: AgentObject, state) => {
      const advanced = await turnRunner(state.storage).advance({
        inference: inference({ content: "unused", toolCalls: [] }),
        tools: [probeTool],
        scheduleRecovery: async (wakeAt) =>
          await state.storage.setAlarm(wakeAt),
        executor: { execute: () => Promise.resolve({ value: "durable" }) },
      });
      expect(advanced.kind).toBe("advanced");
    });

    await evictDurableObject(stub);
    await runInDurableObject(stub, async (_instance: AgentObject, state) => {
      const advanced = await turnRunner(state.storage).advance({
        inference: inference({ content: "durable answer", toolCalls: [] }),
        tools: [probeTool],
        scheduleRecovery: async (wakeAt) =>
          await state.storage.setAlarm(wakeAt),
        executor: { execute: () => Promise.resolve({ value: "durable" }) },
      });
      expect(advanced.kind).toBe("terminal");
      const turn = await turnRunner(state.storage).active();
      expect(turn?.phase).toEqual({
        kind: "completed",
        result: "durable answer",
      });
    });
  });
});

const probeTool = {
  definition: {
    name: "probe",
    description: "Read the durable probe.",
    parameters: { type: "object", properties: {} },
  },
  effect: "read_only" as const,
};

function turnRunner(storage: DurableObjectStorage) {
  return new DurableTurnRunner(agentCellPersistence(storage), "agent");
}

function inference(result: {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: object }[];
}) {
  return {
    model: {
      id: "test-model",
      contextWindowTokens: 1_000_000,
      limitSource: "provider" as const,
    },
    estimateTokens: () => 10,
    complete: () => Promise.resolve(result),
  };
}
