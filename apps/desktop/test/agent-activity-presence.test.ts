import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
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
