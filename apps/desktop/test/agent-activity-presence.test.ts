import assert from "node:assert/strict";
import test from "node:test";

import { agentIdSchema } from "@chief/relay-contracts";

import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
  scheduledAgentActivityPresence,
  taskIsActivelyWorking,
} from "../src/components/chat/agent-activity-presence.ts";

void test("activity presence preserves simultaneous agents instead of choosing the latest", () => {
  const agents = mergeAgentActivityPresence(
    { id: "prospector", label: "Prospector" },
    [
      { id: "brand", label: "Marketer", taskId: "brand-task" },
      { id: "setup", label: "Setup", taskId: "setup-task" },
    ],
  );

  assert.deepEqual(
    agents.map((agent) => agent.id),
    ["prospector", "brand", "setup"],
  );
  assert.equal(
    formatAgentActivityStatus(agents),
    "Prospector, Marketer, and Setup are working…",
  );
});

void test("the same agent is shown once when a root turn and task overlap", () => {
  const agents = mergeAgentActivityPresence(
    { id: "prospector", label: "Prospector" },
    [
      {
        id: "prospector",
        label: "Prospector",
        taskId: "prospector-task",
      },
    ],
  );

  assert.equal(agents.length, 1);
});

void test("only running tasks keep the live activity matrix visible", () => {
  assert.equal(taskIsActivelyWorking({ status: "running" }), true);
  assert.equal(taskIsActivelyWorking({ status: "idle" }), false);
  assert.equal(taskIsActivelyWorking({ status: "completed" }), false);
});

void test("scheduled activity shows running assignments only and stays scoped to the open thread", () => {
  const step = {
    id: "step",
    commandId: "command",
    agentId: agentIdSchema.parse("brand"),
    phase: "contribute" as const,
    state: "running" as const,
  };
  const run = {
    state: "running" as const,
    threadRootId: "thread-a",
    steps: [
      step,
      {
        ...step,
        id: "pending",
        agentId: agentIdSchema.parse("writer"),
        state: "pending" as const,
      },
    ],
  };
  const label = (id: string) => id;
  assert.deepEqual(scheduledAgentActivityPresence([run, run], label), [
    { id: "brand", label: "brand" },
  ]);
  assert.deepEqual(
    scheduledAgentActivityPresence([run], label, "thread-b"),
    [],
  );
  for (const state of [
    "queued",
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ] as const) {
    assert.deepEqual(
      scheduledAgentActivityPresence([{ ...run, state }], label),
      [],
    );
  }
  assert.deepEqual(
    scheduledAgentActivityPresence(
      [{ ...run, steps: [{ ...step, state: "completed" }] }],
      label,
    ),
    [],
  );
});
