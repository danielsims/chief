import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentDefinition,
  AgentPreference,
  AgentProfile,
} from "@chief/agent-runtime/types";

import { executionPreferencesForTeam } from "../src/lib/agent-execution-preferences.ts";

const subagents: AgentProfile[] = [
  {
    id: "brand",
    name: "Brand",
    role: "Brand strategist",
    description: "Owns brand work.",
    instructions: "",
  },
];
const chief: AgentDefinition = {
  id: "chief",
  name: "Chief",
  role: "Chief of staff",
  description: "Coordinates the team.",
  instructions: "",
  subagents,
};

void test("subagent assignment covers only the agent and its subagents", () => {
  const current: AgentPreference[] = [
    {
      agentId: "chief",
      enabled: false,
      approvals: "ask",
      integrations: ["slack"],
    },
  ];

  const next = executionPreferencesForTeam(
    chief,
    current,
    "desktop",
    "codex",
    "gpt-5.6",
  );

  assert.deepEqual(next, [
    {
      agentId: "chief",
      enabled: false,
      approvals: "ask",
      integrations: ["slack"],
      deploymentTarget: "desktop",
      driver: "codex",
      model: "gpt-5.6",
    },
    {
      agentId: "brand",
      enabled: true,
      deploymentTarget: "desktop",
      driver: "codex",
      model: "gpt-5.6",
    },
  ]);
});
