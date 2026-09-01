import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "@chief/agent-runtime/types";

import { removeAgentFromRoster } from "../src/lib/agent-roster-state.ts";

const agents = [
  { id: "chief", name: "Chief" },
  { id: "researcher", name: "Researcher" },
] as AgentDefinition[];

void test("removes a deleted agent from the shared roster without mutating it", () => {
  const next = removeAgentFromRoster(agents, "researcher");

  assert.deepEqual(
    next.map((agent) => agent.id),
    ["chief"],
  );
  assert.deepEqual(
    agents.map((agent) => agent.id),
    ["chief", "researcher"],
  );
});
