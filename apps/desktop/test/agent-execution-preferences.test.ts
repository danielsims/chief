import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentDefinition,
  AgentPreference,
} from "@chief/agent-runtime/types";

import { executionPreferencesForTeam } from "../src/lib/agent-execution-preferences.ts";

const agents: AgentDefinition[] = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    description: "Coordinates the team.",
    instructions: "",
  },
  {
    id: "brand",
    name: "Brand",
    role: "Brand strategist",
    description: "Owns brand work.",
    instructions: "",
  },
];

void test("team assignment preserves each agent's existing policy", () => {
  const current: AgentPreference[] = [
    {
      agentId: "chief",
      enabled: false,
      approvals: "ask",
      integrations: ["slack"],
    },
  ];

  const next = executionPreferencesForTeam(agents, current, "codex", "gpt-5.6");

  assert.deepEqual(next, [
    {
      agentId: "chief",
      enabled: false,
      approvals: "ask",
      integrations: ["slack"],
      driver: "codex",
      model: "gpt-5.6",
    },
    {
      agentId: "brand",
      enabled: true,
      driver: "codex",
      model: "gpt-5.6",
    },
  ]);
});
